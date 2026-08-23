/**
 * Pure damage math. No Foundry globals — see tiers.mjs for the same contract.
 *
 * Crows layers vitality: Armor Defense absorbs first and is a depleting pool on
 * each item, Stamina absorbs next, and only once BOTH are exhausted does damage
 * convert to wounds at 1 wound per 1 damage (R p12). Piercing damage skips the
 * armor layer entirely.
 *
 * Wounds are placed into specific backpack slots, which is what makes them
 * expensive: a wounded slot that also holds cargo costs a point of speed.
 */

/**
 * Choose which backpack slots newly-taken wounds occupy.
 *
 * The rules say the PC chooses. Automating that choice needs a default that a
 * player would essentially always pick, so empty slots are filled before loaded
 * ones — a wound on an empty slot is free, a wound sharing a slot with cargo
 * costs speed. Players can still move wounds afterwards on the sheet.
 *
 * @param {string[]} wounds        Current per-slot wound kinds ("" = clear).
 * @param {Set<number>} occupied   Slot indices currently holding an item.
 * @param {number} count           How many wounds to place.
 * @returns {number[]}             Slot indices chosen, in fill order.
 */
export function chooseWoundSlots(wounds, occupied, count) {
  const free = [];
  const loaded = [];
  for (let i = 0; i < wounds.length; i++) {
    if (wounds[i] !== "") continue;
    if (occupied.has(i)) loaded.push(i);
    else free.push(i);
  }
  return [...free, ...loaded].slice(0, count);
}

/**
 * Resolve a hit against a crow's layered vitality.
 *
 * @param {object} opts
 * @param {number} opts.damage
 * @param {boolean} [opts.piercing]      Bypasses Armor Defense entirely.
 * @param {Array<{id: string, value: number}>} [opts.adSources]
 *        Worn armor and wielded shields, in the order they should absorb. The
 *        crow chooses this order (R p12), so the caller supplies it.
 * @param {number} opts.stamina
 * @param {string[]} opts.wounds         Per-slot wound kinds.
 * @param {Set<number>} [opts.occupied]  Slots holding cargo.
 * @param {string} [opts.woundKind]
 * @returns {{adSpent: Object<string, number>, staminaAfter: number,
 *            woundSlots: number[], woundsTaken: number, dead: boolean,
 *            absorbedByArmor: number, absorbedByStamina: number}}
 */
export function applyDamage({
  damage,
  piercing = false,
  adSources = [],
  stamina,
  wounds,
  occupied = new Set(),
  woundKind = "normal"
}) {
  let remaining = Math.max(0, Math.trunc(damage));
  const adSpent = {};
  let absorbedByArmor = 0;

  // 1. Armor Defense, unless the damage pierces.
  if (!piercing) {
    for (const source of adSources) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, Math.max(0, source.value));
      if (take <= 0) continue;
      adSpent[source.id] = take;
      absorbedByArmor += take;
      remaining -= take;
    }
  }

  // 2. Stamina.
  const absorbedByStamina = Math.min(remaining, Math.max(0, stamina));
  const staminaAfter = Math.max(0, stamina - absorbedByStamina);
  remaining -= absorbedByStamina;

  // 3. Wounds — only now, and only if BOTH prior pools are spent.
  const woundSlots = remaining > 0 ? chooseWoundSlots(wounds, occupied, remaining) : [];

  // More damage than free slots still kills: filling every slot is death.
  const totalWounded = wounds.filter((w) => w !== "").length + woundSlots.length;

  return {
    adSpent,
    staminaAfter,
    woundSlots,
    woundKind,
    woundsTaken: woundSlots.length,
    /** Damage with nowhere left to go. The crow is already dead. */
    overflow: remaining - woundSlots.length,
    dead: totalWounded >= wounds.length,
    absorbedByArmor,
    absorbedByStamina
  };
}

/**
 * Damage against a Ref-controlled creature.
 *
 * Monsters simply die at 0 Stamina. Humans and animals take wounds like a crow,
 * but the rules give them no slot inventory, so their wounds are a counter.
 */
export function applyCreatureDamage({ damage, piercing = false, ad = 0, stamina, wounds = 0, woundMax = 10, usesWounds = false }) {
  let remaining = Math.max(0, Math.trunc(damage));

  let adAfter = ad;
  if (!piercing) {
    const take = Math.min(remaining, Math.max(0, ad));
    adAfter = ad - take;
    remaining -= take;
  }

  const absorbedByStamina = Math.min(remaining, Math.max(0, stamina));
  const staminaAfter = Math.max(0, stamina - absorbedByStamina);
  remaining -= absorbedByStamina;

  if (!usesWounds) {
    return { adAfter, staminaAfter, woundsAfter: wounds, dead: staminaAfter <= 0, overflow: remaining };
  }

  const woundsAfter = Math.min(woundMax, wounds + remaining);
  return {
    adAfter,
    staminaAfter,
    woundsAfter,
    dead: woundsAfter >= woundMax,
    overflow: Math.max(0, wounds + remaining - woundMax)
  };
}

/**
 * Speed lost to wounds (R p12).
 *
 * "For each slot occupied by a wound and an item, your speed is reduced by 1."
 * The strict reading counts only slots holding BOTH; the loose reading counts
 * either. The loose reading floors a fully-packed starting crow at speed 0
 * before they take a scratch, so `both` is the default.
 */
export function speedPenalty(wounds, occupied, rule = "both") {
  let penalty = 0;
  for (let i = 0; i < wounds.length; i++) {
    const wounded = wounds[i] !== "";
    const packed = occupied.has(i);
    if (rule === "either") penalty += wounded || packed ? 1 : 0;
    else penalty += wounded && packed ? 1 : 0;
  }
  return penalty;
}

/**
 * Healing from a completed rest (R p14): full Stamina, and one wound removed.
 * Starvation wounds are NOT removed by resting — they clear only by eating
 * (R p16) — so they are excluded from the candidate set.
 */
export function restRecovery(wounds, { woundsHealed = 1, preferKind = "normal" } = {}) {
  const next = [...wounds];
  let healed = 0;
  // Remove ordinary wounds first; starvation and special wounds have their own
  // cures and must survive a rest.
  for (let i = next.length - 1; i >= 0 && healed < woundsHealed; i--) {
    if (next[i] === preferKind) {
      next[i] = "";
      healed++;
    }
  }
  return { wounds: next, healed };
}

/** Eating a ration clears every starvation wound at once (R p16). */
export function clearStarvation(wounds) {
  const next = wounds.map((w) => (w === "starvation" ? "" : w));
  return { wounds: next, cleared: wounds.filter((w) => w === "starvation").length };
}
