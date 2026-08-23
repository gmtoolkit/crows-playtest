import { CROWS } from "../config.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/**
 * The creature sheet — monsters, humans, and animals.
 *
 * Laid out like the printed stat block, because that is what a Ref reads at
 * speed mid-encounter: identity line, characteristics, the attack table with
 * its 12-16 / 17+ columns, then named features and the type's likes and hates.
 */
export default class CreatureSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["crows", "sheet", "creature"],
    position: { width: 620, height: 720 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      rollCharacteristic: CreatureSheet.#onRollCharacteristic,
      useItem: CreatureSheet.#onUseItem,
      editItem: CreatureSheet.#onEditItem,
      deleteItem: CreatureSheet.#onDeleteItem,
      addAttack: CreatureSheet.#onAddAttack,
      addFeature: CreatureSheet.#onAddFeature,
      harvest: CreatureSheet.#onHarvest
    },
    dragDrop: [{ dragSelector: "[data-item-id]", dropSelector: null }]
  };

  static PARTS = {
    header: { template: "systems/crows/templates/actor/creature-header.hbs" },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    statblock: { template: "systems/crows/templates/actor/creature-statblock.hbs", scrollable: [""] },
    lore: { template: "systems/crows/templates/actor/creature-lore.hbs", scrollable: [""] }
  };

  static TABS = {
    sheet: {
      tabs: [
        { id: "statblock", icon: "fa-solid fa-skull" },
        { id: "lore", icon: "fa-solid fa-book-skull" }
      ],
      initial: "statblock",
      labelPrefix: "CROWS.Tabs"
    }
  };

  /* -------------------------------------------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const sys = actor.system;

    context.actor = actor;
    context.system = sys;
    context.CROWS = CROWS;
    context.editable = this.isEditable;
    context.tabs = this._prepareTabs("sheet");

    context.characteristics = Object.entries(CROWS.characteristics).map(([key, cfg]) => ({
      key,
      label: game.i18n.localize(cfg.label),
      abbr: game.i18n.localize(cfg.abbr),
      value: sys.characteristics[key].value
    }));

    context.attacks = actor.items.filter((i) => i.type === "attack");
    context.features = actor.items.filter((i) => i.type === "feature");
    context.gear = actor.items.filter((i) => ["gear", "weapon", "armor", "spellbook"].includes(i.type));

    // "6, climb 6 (U)" — rebuild the printed speed line from the parts.
    context.speedLine = this.#speedLine(sys.speed);

    context.sizeLabel = game.i18n.localize(CROWS.sizes[sys.size]?.label ?? sys.size);
    context.typeLabel = sys.monsterType
      ? game.i18n.localize(CROWS.monsterTypes[sys.monsterType]?.label ?? sys.monsterType)
      : game.i18n.localize(CROWS.creatureCategories[sys.category]);

    context.universal = CROWS.universalMonsterDrives;

    context.enrichedDescription = await foundry.applications.ux.TextEditor.enrichHTML(sys.description, {
      relativeTo: actor
    });
    context.enrichedSecrets = await foundry.applications.ux.TextEditor.enrichHTML(sys.secrets, {
      relativeTo: actor,
      secrets: actor.isOwner
    });

    return context;
  }

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (partId in context.tabs) context.tab = context.tabs[partId];
    return context;
  }

  #speedLine(speed) {
    const parts = [`${speed.walk}`];
    if (speed.climb) parts.push(`${game.i18n.localize("CROWS.Climb")} ${speed.climb}${speed.upsideDown ? " (U)" : ""}`);
    if (speed.fly) parts.push(`${game.i18n.localize("CROWS.Fly")} ${speed.fly}`);
    if (speed.swim) parts.push(`${game.i18n.localize("CROWS.Swim")} ${speed.swim}`);
    if (speed.burrow) parts.push(`${game.i18n.localize("CROWS.Burrow")} ${speed.burrow}`);
    return parts.join(", ");
  }

  /* -------------------------------------------- */

  static async #onRollCharacteristic(event, target) {
    return this.actor.rollTest({ characteristic: target.dataset.characteristic, skipDialog: event.shiftKey });
  }

  static async #onUseItem(event, target) {
    return this.#itemFor(target)?.use({ skipDialog: event.shiftKey });
  }

  static async #onEditItem(event, target) {
    return this.#itemFor(target)?.sheet.render(true);
  }

  static async #onDeleteItem(event, target) {
    return this.#itemFor(target)?.delete();
  }

  static async #onAddAttack() {
    const created = await this.actor.createEmbeddedDocuments("Item", [
      { name: game.i18n.localize("CROWS.NewAttack"), type: "attack" }
    ]);
    return created[0]?.sheet.render(true);
  }

  static async #onAddFeature() {
    const created = await this.actor.createEmbeddedDocuments("Item", [
      { name: game.i18n.localize("CROWS.NewFeature"), type: "feature" }
    ]);
    return created[0]?.sheet.render(true);
  }

  /**
   * The Harvest rest activity (R p15): destroy the corpse for crafting parts.
   * Yield scales with size, which is the whole reason to drag a big body home.
   */
  static async #onHarvest() {
    const formula = this.actor.system.harvestDice;
    const roll = await new Roll(formula).evaluate();
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: game.i18n.format("CROWS.HarvestedParts", { name: this.actor.name })
    });
  }

  #itemFor(target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    return id ? this.actor.items.get(id) : null;
  }
}
