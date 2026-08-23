import { CROWS } from "../config.mjs";
import { earnedBonuses, earnedCharacteristicBonuses } from "./advancement.mjs";

/**
 * Treasure into XP (C p6).
 *
 * "Whenever you recover treasure or equipment outside of a village that isn't
 * purchased by your group, crafted by your group, taken from an innocent
 * human, or something that originally belonged to an ally, each PC gains
 * experience points (XP) equal to the item's total value in gc divided by the
 * number of players. Unique items don't have a cost. Their XP value is listed
 * on their cards."
 *
 * THIS IS THE EVENT THAT WAS MISSING. Without it the only moment the system
 * ever mentioned advancement was the rest, which made a rest look like the
 * thing that hands out bonuses. Recovering treasure is what earns them; the
 * rest is only when you may take them.
 *
 * Pure: no Foundry globals, so the split and the threshold crossings are
 * testable without a world.
 */

/**
 * Split a haul between the crows who share it.
 *
 * "divided by the number of players" — the divisor is the PARTY, not the
 * number of crows present, and not the number of items.
 *
 * Rounding is DOWN and the remainder is reported rather than silently dropped
 * or silently handed to someone: at a table, a leftover gc is a conversation,
 * not a rounding rule the book ever stated.
 */
export function splitTreasure(totalGc, partySize) {
  const total = Math.max(0, Math.floor(Number(totalGc) || 0));
  const size = Math.max(1, Math.floor(Number(partySize) || 1));
  const each = Math.floor(total / size);
  return { each, remainder: total - each * size, partySize: size, total };
}

/**
 * Which advancement thresholds an XP award pushes a crow across.
 *
 * Reported per crow because the answer depends on where they already were: two
 * crows given the same XP can cross a different number of thresholds, and the
 * one who levels needs telling.
 */
export function thresholdsCrossed(txpBefore, txpAfter) {
  const before = earnedBonuses(txpBefore);
  const after = earnedBonuses(txpAfter);
  const charBefore = earnedCharacteristicBonuses(txpBefore);
  const charAfter = earnedCharacteristicBonuses(txpAfter);

  return {
    bonuses: Math.max(0, after.count - before.count),
    characteristics: Math.max(0, charAfter - charBefore),
    maxUsesRose: after.maxUses > before.maxUses,
    newMaxUses: after.maxUses,
    // Both tables pay out at 5,000 and 30,000 TXP, so a single award can
    // legitimately grant one of each.
    any: after.count > before.count || charAfter > charBefore
  };
}

/**
 * The gc value of a pile of items.
 *
 * Unique items carry no cost and print an XP value on the card instead, so
 * those are counted from `xpValue` and NOT multiplied by quantity-of-nothing.
 */
export function haulValue(items = []) {
  let gc = 0;
  let uniqueXp = 0;
  for (const item of items) {
    const qty = Math.max(1, Number(item.quantity) || 1);
    if (item.unique) uniqueXp += (Number(item.xpValue) || 0) * qty;
    else gc += (Number(item.cost) || 0) * qty;
  }
  return { gc, uniqueXp, total: gc + uniqueXp };
}

/** The reasons the book gives for treasure NOT counting (C p6). */
export const EXCLUSIONS = [
  "purchased",
  "crafted",
  "fromInnocent",
  "fromAlly",
  "insideVillage"
];

/**
 * Whether a haul qualifies at all.
 *
 * Deliberately a Ref decision rather than an automatic hook on item creation:
 * every one of these exclusions is about PROVENANCE, which no item field
 * records. A blind "item entered inventory means XP" rule would pay a crow for
 * buying a torch.
 */
export function qualifies(flags = {}) {
  return !EXCLUSIONS.some((key) => flags[key]);
}
