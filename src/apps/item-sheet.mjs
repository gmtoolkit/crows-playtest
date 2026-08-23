import { CROWS } from "../config.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * One sheet for every item type.
 *
 * The inventory cards share most of their anatomy (slots, stack, usage dice,
 * price, crafting), so the sheet renders that common block and then whichever
 * type-specific block applies. Splitting into eight sheets would duplicate the
 * card block eight times.
 */
export default class CrowsItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["crows", "sheet", "item"],
    position: { width: 520, height: 640 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      addProperty: CrowsItemSheet.#onAddProperty,
      removeProperty: CrowsItemSheet.#onRemoveProperty,
      addEnchantment: CrowsItemSheet.#onAddEnchantment,
      removeEnchantment: CrowsItemSheet.#onRemoveEnchantment,
      restoreUD: CrowsItemSheet.#onRestoreUD
    }
  };

  static PARTS = {
    header: { template: "systems/crows/templates/item/item-header.hbs" },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    details: { template: "systems/crows/templates/item/item-details.hbs", scrollable: [""] },
    card: { template: "systems/crows/templates/item/item-card-block.hbs", scrollable: [""] },
    description: { template: "systems/crows/templates/item/item-description.hbs", scrollable: [""] }
  };

  static TABS = {
    sheet: {
      tabs: [
        { id: "details", icon: "fa-solid fa-list" },
        { id: "card", icon: "fa-solid fa-id-card" },
        { id: "description", icon: "fa-solid fa-align-left" }
      ],
      initial: "details",
      labelPrefix: "CROWS.Tabs"
    }
  };

  /* -------------------------------------------- */

  /** Card fields (slots, stack, UD, price) only exist on carryable types. */
  get isCard() {
    return ["gear", "weapon", "armor", "spellbook"].includes(this.item.type);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    context.item = this.item;
    context.system = this.item.system;
    context.CROWS = CROWS;
    context.editable = this.isEditable;
    context.isCard = this.isCard;
    context.tabs = this._prepareTabs("sheet");

    context.isWeapon = this.item.type === "weapon";
    context.isArmor = this.item.type === "armor";
    context.isSpellbook = this.item.type === "spellbook";
    context.isGear = this.item.type === "gear";
    context.isTrait = this.item.type === "trait";
    context.isBackground = this.item.type === "background";
    context.isAttack = this.item.type === "attack";
    context.isFeature = this.item.type === "feature";
    context.hasAttack = ["weapon", "attack"].includes(this.item.type) || this.item.system.isAttack;

    context.enrichedDescription = await foundry.applications.ux.TextEditor.enrichHTML(
      this.item.system.description ?? "",
      { relativeTo: this.item }
    );

    // Choice lists rendered as <select> options.
    context.choices = {
      characteristics: {
        agility: "CROWS.Agility",
        mind: "CROWS.Mind",
        strength: "CROWS.Strength",
        agilityOrStrength: "CROWS.AgilityOrStrength",
        agilityOrMind: "CROWS.AgilityOrMind",
        mindOrStrength: "CROWS.MindOrStrength",
        none: "CROWS.NoCharacteristic"
      },
      rangeTypes: { melee: "CROWS.Melee", ranged: "CROWS.Ranged", both: "CROWS.MeleeOrRanged" },
      weaponGroups: CROWS.weaponGroups,
      weaponProperties: CROWS.weaponProperties,
      armorCategories: CROWS.armorCategories,
      disciplines: CROWS.disciplines,
      castingTimes: CROWS.castingTimes,
      areaTypes: CROWS.areaTypes,
      durations: CROWS.spellDurations,
      udTriggers: CROWS.udTriggers,
      udRestore: CROWS.udRestore,
      magicSlots: CROWS.magicSlots,
      traitTrees: CROWS.traitTrees,
      expertises: CROWS.expertises,
      sizes: CROWS.sizes,
      activation: {
        none: "CROWS.ActivationNone",
        free: "CROWS.ActivationFree",
        maneuver: "CROWS.CastManeuver",
        action: "CROWS.CastAction",
        reaction: "CROWS.CastReaction",
        restActivity: "CROWS.ActivationRest"
      }
    };

    return context;
  }

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (partId in context.tabs) context.tab = context.tabs[partId];
    return context;
  }

  /** Hide the card tab entirely for types that have no card block. */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    if (!this.isCard) delete parts.card;
    return parts;
  }

  _getTabsConfig(group) {
    const config = foundry.utils.deepClone(super._getTabsConfig(group));
    if (config && !this.isCard) config.tabs = config.tabs.filter((t) => t.id !== "card");
    return config;
  }

  /* -------------------------------------------- */

  static async #onAddProperty() {
    const properties = [...(this.item.system.properties ?? []), { key: "light", value: null }];
    return this.item.update({ "system.properties": properties });
  }

  static async #onRemoveProperty(event, target) {
    const index = Number(target.dataset.index);
    const properties = [...this.item.system.properties];
    properties.splice(index, 1);
    return this.item.update({ "system.properties": properties });
  }

  static async #onAddEnchantment() {
    const list = [...(this.item.system.enchantments ?? []), { name: "", description: "" }];
    return this.item.update({ "system.enchantments": list });
  }

  static async #onRemoveEnchantment(event, target) {
    const index = Number(target.dataset.index);
    const list = [...this.item.system.enchantments];
    list.splice(index, 1);
    return this.item.update({ "system.enchantments": list });
  }

  static async #onRestoreUD() {
    return this.item.restoreUsageDice();
  }
}
