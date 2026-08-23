import { CROWS } from "../config.mjs";

/**
 * Who may take an item off the shelf, and what it costs them.
 *
 * Pure: no Foundry globals, so every gate is testable without a world.
 *
 * The shape Cliff asked for has one rule that carries the whole design:
 * A PLAYER MAY ALWAYS LOOK. Browsing is never gated. Whether they can TAKE is
 * the only thing a mode changes, because a player who cannot see the catalogue
 * cannot plan, ask for anything, or learn what exists — and "you can't see it"
 * is a far worse table experience than "you can't afford it".
 */

/** How a world hands out equipment. */
export const MODES = {
  /** Players buy from the catalogue with their own coin. */
  purchase: "purchase",
  /** Only the Ref hands things out; players browse but cannot take. */
  gm: "gm"
};

/**
 * Can this viewer take this item, and if not, why not?
 *
 * Returns a reason key rather than a boolean, because every refusal here is
 * one a player needs to act on: earn more coin, ask the Ref, free a slot.
 *
 * @param {object} args
 * @param {boolean} args.isGM
 * @param {string}  args.mode        One of MODES.
 * @param {number}  args.coin        The crow's purse.
 * @param {number}  args.price       The item's price in gc.
 * @param {boolean} args.hasRoom     Whether a legal slot exists for it.
 * @param {boolean} [args.isOwner]   Whether the viewer owns the crow.
 */
export function canTake({ isGM, mode, coin = 0, price = 0, hasRoom = true, isOwner = true }) {
  // The Ref is never gated: granting is the point of the GM path.
  if (isGM) {
    return hasRoom ? { ok: true, cost: 0 } : { ok: false, reason: "noRoom", cost: 0 };
  }

  if (!isOwner) return { ok: false, reason: "notYours", cost: 0 };
  if (mode !== MODES.purchase) return { ok: false, reason: "gmOnly", cost: 0 };
  if (!hasRoom) return { ok: false, reason: "noRoom", cost: price };
  if (price > coin) return { ok: false, reason: "tooExpensive", cost: price, short: price - coin };

  return { ok: true, cost: price };
}

/**
 * Whether the viewer may even SEE the catalogue.
 *
 * Always true, and it is a function so the answer is stated somewhere rather
 * than assumed by the absence of a check. If a world ever wants a hidden
 * catalogue it changes here, and every caller already asks.
 */
export function canBrowse() {
  return true;
}

/** The purse after a purchase. Never negative; a caller must gate on canTake first. */
export function purseAfter(coin, cost) {
  return Math.max(0, (Number(coin) || 0) - (Number(cost) || 0));
}

/**
 * Which containers an item of this type may legally go into.
 *
 * A spellbook is equipment like anything else, but a magic item wants a magic
 * slot, and nothing but a wound belongs in a wound.
 */
export function allowedContainers(item) {
  if (item?.system?.magic && item?.system?.magicSlot) return ["magic", "backpack", "belt", "hand"];
  return ["hand", "belt", "backpack"];
}

/** A short, sortable label for what an item does, for the browser's list. */
export function summarise(item) {
  const s = item?.system ?? {};
  switch (item?.type) {
    case "weapon":
      return [s.notationTier2, s.notationTier3].filter(Boolean).join(" / ");
    case "armor":
      return s.ad?.max ? `AD ${s.ad.max}` : "";
    case "spellbook":
      return [s.rank !== undefined ? `R${s.rank}` : null, s.discipline].filter(Boolean).join(" ");
    default:
      return s.light?.bright ? `Light ${s.light.bright}/${s.light.dim}` : "";
  }
}
