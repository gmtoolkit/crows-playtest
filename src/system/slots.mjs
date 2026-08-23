/**
 * Pure inventory-slot logic. No Foundry globals.
 *
 * The rules (R p10-11):
 *   - 2 hand slots, 4 belt slots, 10 numbered backpack slots.
 *   - A multi-slot item occupies CONSECUTIVE slots of the SAME container.
 *     "You can't carry a 10-foot pole with one hand slot and one belt slot, and
 *     you can't place your 10-foot pole in backpack slots 2 and 7."
 *   - Stacking puts several of one kind in a single slot (5 potions, 3 locks,
 *     2 flasks of lantern oil), but "each hand can only hold one item at a
 *     time, so you can't stack items in hand slots".
 *
 * A stack is modelled as ONE item with `quantity > 1` occupying one slot, which
 * mirrors the physical cards (one card, count written on it).
 */

export const CONTAINER_SIZES = { hand: 2, belt: 4, backpack: 10, magic: 6 };

export const MAGIC_SLOT_KEYS = ["head", "neck", "waist", "arms", "finger", "feet"];

/**
 * Build a slot -> itemId map for one container.
 *
 * @param {Array<{id: string, container: string, index: number|null, span: number}>} placements
 * @param {string} container
 * @returns {Map<number, string>}
 */
export function occupancy(placements, container) {
  const map = new Map();
  for (const p of placements) {
    if (p.container !== container || p.index === null || p.index === undefined) continue;
    const span = Math.max(1, p.span ?? 1);
    for (let i = 0; i < span; i++) map.set(p.index + i, p.id);
  }
  return map;
}

/**
 * Can `item` be placed at `container[index]`?
 *
 * @param {object} opts
 * @param {Array} opts.placements      Every currently-placed item.
 * @param {string} opts.itemId         The item being moved (ignored in collisions).
 * @param {number} opts.span           Slots the item consumes.
 * @param {string} opts.container
 * @param {number} opts.index
 * @param {number} [opts.quantity]     For the hand-stacking rule.
 * @returns {{ok: boolean, reason?: string, blockedBy?: string[]}}
 */
export function canPlace({ placements, itemId, span = 1, container, index, quantity = 1 }) {
  const size = CONTAINER_SIZES[container];
  if (size === undefined) return { ok: false, reason: "unknownContainer" };
  if (container === "magic") return { ok: false, reason: "useMagicSlotKey" };

  if (!Number.isInteger(index) || index < 0) return { ok: false, reason: "badIndex" };

  // A multi-slot item must fit entirely inside one container — this is what
  // stops a 10-foot pole spanning a hand slot and a belt slot.
  if (index + span > size) return { ok: false, reason: "doesNotFit" };

  // Hands hold exactly one thing each, so a stack cannot go there.
  if (container === "hand" && quantity > 1) return { ok: false, reason: "noStackingInHands" };

  const others = placements.filter((p) => p.id !== itemId);
  const map = occupancy(others, container);

  const blockedBy = [];
  for (let i = 0; i < span; i++) {
    const occupant = map.get(index + i);
    if (occupant) blockedBy.push(occupant);
  }
  if (blockedBy.length) return { ok: false, reason: "occupied", blockedBy: [...new Set(blockedBy)] };

  return { ok: true };
}

/**
 * First index in a container where an item of `span` slots fits.
 * Returns null when there is no run of consecutive free slots long enough —
 * which is the common case that makes a bulky item genuinely awkward to carry.
 */
export function firstFit({ placements, itemId, span = 1, container }) {
  const size = CONTAINER_SIZES[container];
  if (size === undefined) return null;
  for (let i = 0; i + span <= size; i++) {
    if (canPlace({ placements, itemId, span, container, index: i }).ok) return i;
  }
  return null;
}

/**
 * Which magic-item slots hold more than one item. Doubling up means the body is
 * "overwhelmed with chaos": no resting, and 1d6 wounds at the end of every
 * dungeon turn (R p11).
 */
export function magicSlotOverload(placements) {
  const counts = {};
  for (const p of placements) {
    if (p.container !== "magic" || !p.magicSlot) continue;
    counts[p.magicSlot] = (counts[p.magicSlot] ?? 0) + 1;
  }
  return Object.entries(counts)
    .filter(([, n]) => n > 1)
    .map(([slot]) => slot);
}

/**
 * The Draw From Pack maneuver (R p11): declare an item, roll 1d10, and you get
 * it out if the roll is at least as high as ONE of the slots it occupies.
 *
 * A bulky item therefore comes out MORE easily than a small one, because it
 * spans more slots and only needs to beat the lowest — and anything in slot 1
 * is nearly always reachable.
 *
 * @param {number} face   The d10 result.
 * @param {number} index  Zero-based first slot the item occupies.
 * @param {number} span
 */
export function canDrawFromPack(face, index, span = 1) {
  // Slots are numbered 1..10 on the sheet; `index` is zero-based.
  const slotNumbers = Array.from({ length: Math.max(1, span) }, (_, i) => index + i + 1);
  return slotNumbers.some((n) => face >= n);
}

/**
 * Total slots a set of items consumes in one container.
 * Used to warn when a background's starting kit does not fit.
 */
export function slotsUsed(placements, container) {
  return placements
    .filter((p) => p.container === container)
    .reduce((sum, p) => sum + Math.max(1, p.span ?? 1), 0);
}
