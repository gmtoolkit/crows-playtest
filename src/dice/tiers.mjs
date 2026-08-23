/**
 * Pure rules math for the Crows power roll.
 *
 * Deliberately free of every Foundry global so `node --test` can exercise it
 * directly. Nothing in here may reference `game`, `CONFIG`, `Roll`, or `ui`.
 */

export const TIER_2_MIN = 12;
export const TIER_3_MIN = 17;
export const CRIT_MIN = 19;
export const DOOM_MAX = 3;
export const EDGE_BONUS = 2;
export const BANE_PENALTY = -2;

/**
 * Resolve a pile of edges and banes into one net state (R p8).
 *
 * The rules describe this as a table, but it collapses cleanly: cap each side
 * at 2 ("regardless of how many individual edges contribute to the double
 * edge") and subtract.
 *
 *   net  2 = double edge  -> improve one tier, no numeric bonus
 *   net  1 = single edge  -> +2
 *   net  0 = nothing
 *   net -1 = single bane  -> -2
 *   net -2 = double bane  -> worsen one tier, no numeric penalty
 *
 * Verify against the printed cases: one edge + one bane cancels (1-1=0); a
 * double edge and a double bane cancel (2-2=0); a double edge with one bane
 * leaves one edge (2-1=1); a double bane with one edge leaves one bane (1-2=-1).
 *
 * @param {number} edges  Count of edges applying to the test.
 * @param {number} banes  Count of banes applying to the test.
 * @returns {{net: number, modifier: number, tierShift: number}}
 */
export function resolveEdgesAndBanes(edges = 0, banes = 0) {
  const e = Math.min(Math.max(0, Math.trunc(edges)), 2);
  const b = Math.min(Math.max(0, Math.trunc(banes)), 2);
  const net = e - b;

  let modifier = 0;
  let tierShift = 0;
  if (net === 1) modifier = EDGE_BONUS;
  else if (net === -1) modifier = BANE_PENALTY;
  else if (net === 2) tierShift = 1;
  else if (net === -2) tierShift = -1;

  return { net, modifier, tierShift };
}

/**
 * The tier a raw total falls into, before any tier shifting.
 * @param {number} total
 * @returns {1|2|3}
 */
export function tierForTotal(total) {
  if (total >= TIER_3_MIN) return 3;
  if (total >= TIER_2_MIN) return 2;
  return 1;
}

/** Clamp a tier into the legal 1..3 band. */
export function clampTier(tier) {
  return Math.min(3, Math.max(1, tier));
}

/**
 * Is this a crit or a doom? Read off the UNMODIFIED dice only — "when the dice
 * without any modifiers equal a 19 or 20" (R p7). This is why a crit beats a
 * double bane and a doom beats any bonus.
 *
 * @param {number[]} dice  The raw d10 faces.
 */
export function readSpecial(dice) {
  const sum = dice.reduce((a, b) => a + b, 0);
  return {
    sum,
    crit: sum >= CRIT_MIN,
    doom: sum <= DOOM_MAX
  };
}

/**
 * Resolve a complete power roll.
 *
 * Order of operations is load-bearing:
 *  1. Edges/banes reduce to a numeric modifier OR a tier shift, never both.
 *  2. The tier comes from the modified total.
 *  3. The tier shift applies.
 *  4. Crit and doom then OVERRIDE the result outright, because the rules grant
 *     them "regardless of banes or other penalties" and "regardless of edges,
 *     expertises, and other bonuses" respectively.
 *
 * @param {object} opts
 * @param {number[]} opts.dice       Raw d10 faces (normally two).
 * @param {number} [opts.mod]        Characteristic modifier.
 * @param {number} [opts.bonus]      Flat bonuses/penalties that are not edges.
 * @param {number} [opts.edges]
 * @param {number} [opts.banes]
 * @returns {{total: number, tier: 1|2|3, baseTier: 1|2|3, crit: boolean,
 *            doom: boolean, rawSum: number, net: number, modifier: number,
 *            tierShift: number, canApplyExpertise: boolean}}
 */
export function resolvePowerRoll({ dice, mod = 0, bonus = 0, edges = 0, banes = 0 }) {
  const { net, modifier, tierShift } = resolveEdgesAndBanes(edges, banes);
  const { sum: rawSum, crit, doom } = readSpecial(dice);

  const total = rawSum + mod + bonus + modifier;
  const baseTier = tierForTotal(total);

  let tier = clampTier(baseTier + tierShift);

  // Crit and doom are absolute. They cannot both fire: a 2d10 sum cannot be
  // both >= 19 and <= 3.
  if (doom) tier = 1;
  else if (crit) tier = 3;

  return {
    total,
    tier,
    baseTier,
    crit,
    doom,
    rawSum,
    net,
    modifier,
    tierShift,
    /**
     * An expertise improves a result by one tier after the roll (R p8) — but a
     * doom is explicitly immune to expertises, and tier 3 has nowhere to go.
     */
    canApplyExpertise: !doom && tier < 3
  };
}

/**
 * Apply one expertise use to a resolved roll, improving it one tier (max 3).
 * Returns a new result; does not mutate.
 */
export function applyExpertise(result) {
  if (!result.canApplyExpertise) return result;
  const tier = clampTier(result.tier + 1);
  return { ...result, tier, expertiseApplied: true, canApplyExpertise: false };
}

/**
 * Crafting rolls are Mind tests with no tiers: the total becomes points, with a
 * floor of 1 unless the roll doomed (R p36). Double edges and expertises are
 * flat +4 here rather than tier shifts, which is why this does not reuse
 * resolvePowerRoll.
 *
 * @param {object} opts
 * @param {number[]} opts.dice
 * @param {number} [opts.mod]
 * @param {number} [opts.bonus]
 * @param {number} [opts.edges]
 * @param {number} [opts.banes]
 * @param {number} [opts.expertises]  How many expertises are applied (max 2).
 */
export function resolveCraftingRoll({ dice, mod = 0, bonus = 0, edges = 0, banes = 0, expertises = 0 }) {
  const e = Math.min(Math.max(0, Math.trunc(edges)), 2);
  const b = Math.min(Math.max(0, Math.trunc(banes)), 2);
  const net = e - b;

  let modifier = 0;
  if (net === 1) modifier = EDGE_BONUS;
  else if (net === -1) modifier = BANE_PENALTY;
  else if (net === 2) modifier = 4; // double edge is a flat +4 when crafting
  else if (net === -2) modifier = -4;

  const applied = Math.min(2, Math.max(0, Math.trunc(expertises)));
  modifier += applied * 4;

  const { sum: rawSum, crit, doom } = readSpecial(dice);
  const total = rawSum + mod + bonus + modifier;

  return {
    total,
    // A doom accrues nothing; anything else accrues at least 1.
    points: doom ? 0 : Math.max(1, total),
    crit, // a crit grants another crafting roll in the same rest activity
    doom,
    rawSum
  };
}

/**
 * Parse a printed tier outcome into an evaluable damage formula.
 *
 * The books write damage several ways and all of them have to land on the
 * chat card as a number the GM can actually apply:
 *
 *   "3 + S"          weapon card, characteristic spelled out
 *   "2 + A or S"      weapon card, attacker's choice
 *   "4+M"             spellbook card, no spaces
 *   "2 dam"           creature stat block
 *   "8 dam*"          creature stat block with a rider note
 *   "1d6 P dam"       piercing, bypasses Armor Defense
 *   "6 damage; weakened"  damage plus a condition
 *   "Push 1"          not damage at all
 *
 * Characteristic references collapse to `@mod`, which the roller binds to
 * whichever characteristic was actually used. The last case must yield no
 * formula at all, so the caller does not offer an Apply Damage button for an
 * outcome that deals none.
 *
 * @param {string} text
 * @returns {{formula: string|null, piercing: boolean, rider: boolean, note: string}}
 */
export function parseDamage(text) {
  const empty = { formula: null, piercing: false, rider: false, note: "" };
  if (!text) return empty;

  let s = String(text).trim();

  // A trailing asterisk points at a named rider on the stat block.
  const rider = s.includes("*");
  s = s.replace(/\*/g, "");

  // "6 damage; weakened" — keep the clause, it is not part of the formula.
  let note = "";
  const semi = s.search(/[;,]/);
  if (semi >= 0) {
    note = s.slice(semi + 1).trim();
    s = s.slice(0, semi);
  }

  // A standalone capital P marks piercing damage (R p12). Case matters: it
  // must not match the "p" in "push".
  const piercing = /(^|\s)P(\s|$)/.test(s);
  s = s.replace(/(^|\s)P(\s|$)/g, " ");

  s = s.replace(/\b(dam|damage)\b/gi, " ");

  // Characteristic references become @mod. Pair form first, so "A or S" does
  // not become "@mod or @mod".
  s = s.replace(/\b[AMS]\s+or\s+[AMS]\b/g, "@mod");
  s = s.replace(/(?<![\w@])[AMS](?![\w])/g, "@mod");

  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^[+\s]+/, "").replace(/[+\s]+$/, "").trim();

  // Anything left that is not arithmetic over numbers, dice, and @mod is prose
  // ("Push 1", "The target can counter") and yields no damage.
  const numeric = /^[\d\s+\-*/().]*(?:(?:\d*d\d+|@mod|\d+)[\s+\-*/().]*)+$/i;
  if (!s || !numeric.test(s)) return { ...empty, piercing, rider, note };

  return { formula: s, piercing, rider, note };
}

/**
 * Roll a usage-dice pool: every die showing 1 or 2 is removed (R p13).
 * @param {number[]} faces  The d6 results.
 * @param {number} current  Dice in the pool before rolling.
 */
export function resolveUsageDice(faces, current) {
  const spent = faces.filter((f) => f === 1 || f === 2).length;
  const remaining = Math.max(0, current - spent);
  return { spent, remaining, exhausted: remaining === 0 };
}

/**
 * Encounter check (R p14). An encounter occurs on a d10 result AT OR ABOVE the
 * encounter number, so a HIGHER EN is SAFER — the inverse of what the name
 * suggests, and the easiest thing in this system to implement backwards.
 *
 * @param {number} face  The d10 result.
 * @param {number} en    The encounter number in play.
 */
export function resolveEncounterCheck(face, en) {
  const occurs = face >= en;
  return {
    occurs,
    /** A 10 lands immediately; anything else gives a warning sign first. */
    immediate: occurs && face === 10,
    warning: occurs && face < 10
  };
}

/**
 * Resolve the printed tier damage into something worth showing on a card face.
 *
 * The stored text is the card's own notation ("3 + S", "2 + A or S", "8 dam*")
 * or the normalised "@mod" form. Neither reads well in a 70px slot, and
 * "@mod" reads like a bug. When the item is carried by an actor, substitute
 * that actor's real modifier so the card shows the number this crow deals.
 *
 * Dice expressions stay as formulas — "1d6 + 2" is the honest display.
 *
 * @param {string} text          The printed tier text.
 * @param {Actor|null} actor     The owner, if any.
 * @param {string} characteristic Which characteristic the attack uses.
 * @returns {string}             Display text.
 */
export function displayDamage(text, actor, characteristic) {
  if (!text) return "";
  const parsed = parseDamage(text);
  if (!parsed.formula) return text;

  const mod = actor?.system?.characteristicMod?.(characteristic);
  if (mod === undefined || mod === null) {
    // No owner: show the printed notation rather than the @mod placeholder.
    return text.replace(/@mod/g, "mod");
  }

  // Substitute the bare number: the printed formula already supplies the
  // operator ("3 + @mod"), so injecting one produces "3 + + 2".
  const bound = tidySigns(parsed.formula.replace(/@mod/g, String(mod)));

  // Collapse a pure-arithmetic expression to its value; leave dice alone.
  if (!/d\d/i.test(bound)) {
    const cleaned = bound.replace(/\s+/g, " ").trim();
    if (/^[\d+\-*/() ]+$/.test(cleaned)) {
      try {
        // eslint-disable-next-line no-new-func
        const value = Function(`"use strict"; return (${cleaned});`)();
        if (Number.isFinite(value)) return `${value}${parsed.piercing ? " P" : ""}`;
      } catch {
        /* fall through to the formula */
      }
    }
  }
  return `${bound.replace(/\s+/g, " ").trim()}${parsed.piercing ? " P" : ""}`;
}

/**
 * Collapse doubled signs left by substituting a negative modifier.
 * "3 + -1" reads badly and "1d6 - -2" reads worse; both are also avoidable.
 */
export function tidySigns(formula) {
  return String(formula)
    .replace(/\+\s*-\s*/g, "- ")
    .replace(/-\s*-\s*/g, "+ ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Characteristic abbreviations as the cards print them. */
const ABBR = {
  agility: "A",
  mind: "M",
  strength: "S",
  agilityOrStrength: "A or S",
  agilityOrMind: "A or M",
  mindOrStrength: "M or S",
  none: ""
};

/**
 * Render stored damage back into the notation the printed card uses, so a
 * tooltip reads "3 + S" rather than exposing the internal "@mod" placeholder.
 */
export function damageNotation(text, characteristic) {
  if (!text) return "";
  const abbr = ABBR[characteristic] ?? "";
  return String(text)
    .replace(/@mod/g, abbr)
    .replace(/\+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}
