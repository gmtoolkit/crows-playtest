import { CROWS } from "../config.mjs";
import { canPlace, firstFit, canDrawFromPack } from "../system/slots.mjs";

/**
 * The Item document. Owns "what happens when you use this" and "where does this
 * physically live", so sheets and macros never manipulate slot state directly.
 */
export class CrowsItem extends Item {
  /** Placement descriptors for every item on this item's owner. */
  get siblingPlacements() {
    if (!this.actor) return [];
    return this.actor.items.map((i) => ({
      id: i.id,
      container: i.system?.carried?.container ?? "none",
      index: i.system?.carried?.index ?? null,
      span: Math.max(1, i.system?.slots ?? 1),
      magicSlot: i.system?.carried?.magicSlot ?? null
    }));
  }

  /* -------------------------------------------- */

  /**
   * Use this item. Weapons and attack spells roll; other cards post their
   * activation text and spend an activation-triggered usage die.
   */
  async use(options = {}) {
    if (!this.actor) return ui.notifications.warn(game.i18n.localize("CROWS.ItemNeedsOwner"));

    switch (this.type) {
      case "weapon":
      case "attack":
        return this.actor.rollAttack(this, options);

      case "spellbook":
        if (this.system.exhausted) {
          return ui.notifications.warn(game.i18n.format("CROWS.SpellbookExhausted", { name: this.name }));
        }
        return this.actor.rollAttack(this, options);

      case "gear":
        return this.#useGear(options);

      default:
        return this.toChat();
    }
  }

  async #useGear() {
    await this.toChat();
    // An "activate" pool is rolled on use, after the item's effect resolves.
    if (this.system.ud?.trigger === "activate" && this.system.ud.value > 0) {
      await this.actor.rollItemUsageDice(this, { reason: "activate" });
    }
    return this;
  }

  /** Post the card to chat so the table can read what it does. */
  async toChat() {
    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/crows/templates/chat/item-card.hbs",
      { item: this, system: this.system, actor: this.actor }
    );
    return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this.actor }), content });
  }

  /* -------------------------------------------- */
  /*  Slot management                             */
  /* -------------------------------------------- */

  /**
   * Move this item into a slot, refusing placements the rules forbid.
   * Returns the update result, or null if the move is illegal.
   */
  async moveTo(container, index, { magicSlot = null, notify = true } = {}) {
    if (!this.actor) return null;

    if (container === "none") {
      return this.update({ "system.carried": { container: "none", index: null, magicSlot: null } });
    }

    if (container === "magic") {
      if (!magicSlot || !(magicSlot in CROWS.magicSlots)) {
        if (notify) ui.notifications.warn(game.i18n.localize("CROWS.BadMagicSlot"));
        return null;
      }
      return this.update({ "system.carried": { container: "magic", index: null, magicSlot } });
    }

    const check = canPlace({
      placements: this.siblingPlacements,
      itemId: this.id,
      span: Math.max(1, this.system.slots ?? 1),
      container,
      index,
      quantity: this.system.quantity ?? 1
    });

    if (!check.ok) {
      if (notify) ui.notifications.warn(game.i18n.localize(`CROWS.SlotError.${check.reason}`));
      return null;
    }

    return this.update({ "system.carried": { container, index, magicSlot: null } });
  }

  /** Drop this item into the first place it fits, preferring the backpack. */
  async stow({ order = ["backpack", "belt", "hand"] } = {}) {
    if (!this.actor) return null;
    const span = Math.max(1, this.system.slots ?? 1);
    for (const container of order) {
      const index = firstFit({ placements: this.siblingPlacements, itemId: this.id, span, container });
      if (index !== null) return this.moveTo(container, index, { notify: false });
    }
    ui.notifications.warn(game.i18n.format("CROWS.NoRoomFor", { name: this.name }));
    return null;
  }

  /**
   * The Draw From Pack maneuver (R p11): declare the item, roll 1d10, and
   * retrieve it only if the roll reaches one of its slot numbers.
   */
  async drawFromPack() {
    if (!this.actor) return null;
    const carried = this.system.carried;
    if (carried.container !== "backpack" || carried.index === null) {
      return ui.notifications.warn(game.i18n.localize("CROWS.NotInPack"));
    }

    const roll = await new Roll("1d10").evaluate();
    const span = Math.max(1, this.system.slots ?? 1);
    const success = canDrawFromPack(roll.total, carried.index, span);

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: game.i18n.format(success ? "CROWS.DrewFromPack" : "CROWS.FailedDrawFromPack", { name: this.name })
    });

    if (!success) return null;

    const index = firstFit({ placements: this.siblingPlacements, itemId: this.id, span, container: "hand" });
    if (index === null) {
      ui.notifications.warn(game.i18n.localize("CROWS.HandsFull"));
      return null;
    }
    return this.moveTo("hand", index, { notify: false });
  }

  /* -------------------------------------------- */

  /** Restore this item's usage dice to full (rest, or a refuel). */
  async restoreUsageDice() {
    if (!this.system.ud?.max) return null;
    return this.update({ "system.ud.value": this.system.ud.max });
  }

  /** Repair armor to full AD — the Repair Armor rest activity (R p15). */
  async repair() {
    if (this.type !== "armor") return null;
    return this.update({ "system.ad.value": this.system.ad.max });
  }
}

export default CrowsItem;
