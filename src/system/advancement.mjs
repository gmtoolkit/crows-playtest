import { CROWS } from "../config.mjs";

/**
 * Expertise & Stamina advancement (C p6) and Characteristics advancement
 * (C p7). Pure: no Foundry globals, so every rule here is unit-testable.
 *
 * The shape of the rules, which the model follows exactly:
 *
 *   XP IS NOT WHAT BUYS THIS. XP is spendable currency, and it buys traits and
 *   nothing else. Expertise uses, Stamina and characteristics come free from
 *   TXP — the lifetime total, which spending never reduces — crossing fixed
 *   thresholds. Two currencies, two mechanisms, and conflating them would let a
 *   crow buy a trait and lose an expertise for it.
 *
 *   A BONUS IS ONE PICK FROM THREE PACKAGES, not a pool of points:
 *     - three expertise uses, divided however you like
 *     - +2 Stamina maximum
 *     - one expertise use and +1 Stamina maximum
 *   "Gain three uses in expertises (including expertises you don't already
 *   have) divided however you choose without exceeding the maximum number of
 *   uses for a single expertise." So allocating into an expertise you have
 *   never trained IS how you acquire it; there is no separate learn step.
 *
 *   THE PER-EXPERTISE CAP RISES WITH TXP: 2, then 3 at 5,000, then 4 at
 *   20,000, and never past 4.
 */

/** Which bonus ordinals a lifetime TXP has unlocked, and the cap that comes with them. */
export function earnedBonuses(txp) {
  const table = CROWS.expertiseAdvancement;
  let count = 0;
  let maxUses = CROWS.creation?.startingMaxUses ?? 2;
  for (const row of table) {
    if (txp >= row.txp) {
      count++;
      maxUses = row.maxUses;
    }
  }
  const last = table.at(-1);
  if (txp > last.txp) {
    count += Math.floor((txp - last.txp) / CROWS.expertiseAdvancementStep);
    maxUses = CROWS.expertiseMaxUsesCap;
  }
  return { count, maxUses };
}

/** Characteristic bonuses unlocked by lifetime TXP. */
export function earnedCharacteristicBonuses(txp) {
  const table = CROWS.characteristicAdvancement;
  let count = table.filter((t) => txp >= t).length;
  const last = table.at(-1);
  if (txp > last) count += Math.floor((txp - last) / CROWS.characteristicAdvancementStep);
  return count;
}

/**
 * What a ledger of taken bonuses has handed out.
 *
 * `uses` is per-expertise on purpose. Recording WHERE each granted use landed
 * is what makes a bonus undoable, and it is also what makes the background's
 * own uses derivable without storing them: anything on the sheet that this
 * ledger does not account for came from the background.
 */
export function grantedTotals(bonuses = []) {
  const uses = {};
  let usesTotal = 0;
  let stamina = 0;
  for (const bonus of bonuses) {
    for (const [key, n] of Object.entries(bonus.uses ?? {})) {
      if (!n) continue;
      uses[key] = (uses[key] ?? 0) + n;
      usesTotal += n;
    }
    stamina += bonus.stamina ?? 0;
  }
  return { uses, usesTotal, stamina };
}

/** The uses a crow started with: whatever advancement did not grant. */
export function backgroundUses(expertises = {}, bonuses = []) {
  const { uses: granted } = grantedTotals(bonuses);
  const out = {};
  for (const [key, entry] of Object.entries(expertises)) {
    out[key] = Math.max(0, (entry?.uses ?? 0) - (granted[key] ?? 0));
  }
  return out;
}

/**
 * Check an allocation of a bonus's expertise uses.
 *
 * The budget must be spent EXACTLY. "Gain three uses ... divided however you
 * choose" is a grant, not a spending limit, so leaving one unplaced would
 * quietly lose it — and a use silently lost is worse than a blocked dialog.
 *
 * @param {object} args
 * @param {string} args.option        Key into CROWS.expertiseBonusOptions.
 * @param {Record<string, number>} args.allocation
 * @param {Record<string, {uses: number}>} args.expertises  Current sheet state.
 * @param {number} args.maxUses       Per-expertise cap at this TXP.
 * @returns {{ok: boolean, budget: number, placed: number, errors: string[]}}
 */
export function validateAllocation({ option, allocation = {}, expertises = {}, maxUses }) {
  const errors = [];
  const config = CROWS.expertiseBonusOptions[option];
  if (!config) {
    return { ok: false, budget: 0, placed: 0, errors: [`unknown bonus option "${option}"`] };
  }

  const budget = config.uses;
  let placed = 0;

  for (const [key, raw] of Object.entries(allocation)) {
    const n = Number(raw) || 0;
    if (!n) continue;
    if (!CROWS.expertises[key]) {
      errors.push(`"${key}" is not an expertise`);
      continue;
    }
    if (!Number.isInteger(n) || n < 0) {
      errors.push(`${key}: uses must be a whole number, got ${raw}`);
      continue;
    }
    placed += n;
    const after = (expertises[key]?.uses ?? 0) + n;
    if (after > maxUses) {
      errors.push(`${key} would reach ${after} uses, over the cap of ${maxUses}`);
    }
  }

  if (placed !== budget) {
    errors.push(
      budget === 0
        ? `this option grants no expertise uses, but ${placed} were allocated`
        : `place exactly ${budget} use${budget === 1 ? "" : "s"} (${placed} placed)`
    );
  }

  return { ok: errors.length === 0, budget, placed, errors };
}

/**
 * The update a claimed bonus produces.
 *
 * Stamina is written straight into `stamina.max` because the book says
 * "increase your Stamina maximum by 2" — an imperative, and the sheet's max is
 * the same field the background set. Undoing subtracts the same amount.
 *
 * @returns {{update: object, entry: object}}
 */
export function claimBonus({ option, allocation = {}, expertises = {}, staminaMax = 0, staminaValue = 0 }) {
  const config = CROWS.expertiseBonusOptions[option];
  const entry = { option, uses: {}, stamina: config.stamina };
  const update = {};

  for (const [key, raw] of Object.entries(allocation)) {
    const n = Number(raw) || 0;
    if (!n) continue;
    entry.uses[key] = n;
    update[`system.expertises.${key}.uses`] = (expertises[key]?.uses ?? 0) + n;
  }

  if (config.stamina) {
    update["system.stamina.max"] = staminaMax + config.stamina;
    // A raised maximum should be usable now, not after the next rest: the
    // bonus lands when you finish a rest, which is when Stamina is full.
    update["system.stamina.value"] = Math.min(staminaValue + config.stamina, staminaMax + config.stamina);
  }

  return { update, entry };
}

/** The update that gives a claimed bonus back. */
export function undoBonus({ entry, expertises = {}, staminaMax = 0, staminaValue = 0 }) {
  const update = {};
  for (const [key, n] of Object.entries(entry.uses ?? {})) {
    update[`system.expertises.${key}.uses`] = Math.max(0, (expertises[key]?.uses ?? 0) - n);
  }
  if (entry.stamina) {
    const max = Math.max(0, staminaMax - entry.stamina);
    update["system.stamina.max"] = max;
    update["system.stamina.value"] = Math.min(staminaValue, max);
  }
  return update;
}

/**
 * Refuse to give back a bonus whose uses have since been spent down.
 *
 * Undoing would drive `uses` below what the ledger says it granted, which
 * silently rewrites the background's own uses — the one number nothing else
 * records.
 */
export function undoWouldStrand({ entry, expertises = {} }) {
  const short = [];
  for (const [key, n] of Object.entries(entry.uses ?? {})) {
    if ((expertises[key]?.uses ?? 0) < n) short.push(key);
  }
  return short;
}
