import { CROWS } from "../config.mjs";
import { DungeonTurn } from "../system/dungeon-turn.mjs";
import { placedTokenFor, documentControlContext } from "./token-controls.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/**
 * The crow sheet.
 *
 * Built around the slot grid, because that is literally the sheet MCDM ships:
 * two hand slots, four belt slots, ten numbered backpack slots, and a wound
 * checkbox on every backpack slot. Stats are a thin header above it.
 */
export default class CrowSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["crows", "sheet", "crow"],
    // Wide enough that ten backpack slots fit without a horizontal scrollbar
    // at the default size; narrower windows scroll rather than crush them.
    position: { width: 900, height: 840 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      rollCharacteristic: CrowSheet.#onRollCharacteristic,
      useItem: CrowSheet.#onUseItem,
      editItem: CrowSheet.#onEditItem,
      deleteItem: CrowSheet.#onDeleteItem,
      toggleWound: CrowSheet.#onToggleWound,
      drawFromPack: CrowSheet.#onDrawFromPack,
      rollUsageDice: CrowSheet.#onRollUsageDice,
      toggleExpertiseUse: CrowSheet.#onToggleExpertiseUse,
      openAdvancement: CrowSheet.#onOpenAdvancement,
      wearArmor: CrowSheet.#onWearArmor,
      repairArmor: CrowSheet.#onRepairArmor,
      rest: CrowSheet.#onRest,
      eat: CrowSheet.#onEat,
      buyTrait: CrowSheet.#onBuyTrait,
      openBuilder: CrowSheet.#onOpenBuilder,
      openTurnPanel: CrowSheet.#onOpenTurnPanel,
      openPlacedToken: CrowSheet.#onOpenPlacedToken
    },
    dragDrop: [{ dragSelector: "[data-item-id]", dropSelector: ".crows-slot" }]
  };

  static PARTS = {
    header: { template: "systems/crows/templates/actor/crow-header.hbs" },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    slots: { template: "systems/crows/templates/actor/crow-slots.hbs", scrollable: [""] },
    expertises: { template: "systems/crows/templates/actor/crow-expertises.hbs", scrollable: [""] },
    traits: { template: "systems/crows/templates/actor/crow-traits.hbs", scrollable: [""] },
    bio: { template: "systems/crows/templates/actor/crow-bio.hbs", scrollable: [""] }
  };

  static TABS = {
    sheet: {
      tabs: [
        { id: "slots", icon: "fa-solid fa-grip" },
        { id: "expertises", icon: "fa-solid fa-hand-fist" },
        { id: "traits", icon: "fa-solid fa-diagram-project" },
        { id: "bio", icon: "fa-solid fa-feather" }
      ],
      initial: "slots",
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

    context.containers = this.#prepareContainers();
    context.magicSlots = this.#prepareMagicSlots();
    context.expertiseGroups = this.#prepareExpertises();
    context.traitsByTree = this.#prepareTraits();
    context.unplaced = actor.items.filter(
      (i) => this.#isCarryable(i) && (i.system.carried?.container === "none" || i.system.carried?.index === null)
    );

    context.enrichedNotes = await foundry.applications.ux.TextEditor.enrichHTML(sys.biography.notes, {
      relativeTo: actor,
      secrets: actor.isOwner
    });

    context.dungeonTurn = DungeonTurn.state;
    Object.assign(context, documentControlContext(actor));
    return context;
  }

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (partId in context.tabs) context.tab = context.tabs[partId];
    return context;
  }

  /**
   * Darken the sheet as the crow nears death.
   *
   * Published as CLASSES, never as a numeric custom property.
   *
   * This used to set `--crows-blood` to a 0..1 wound ratio to drive a blood
   * drip. But `--crows-blood` is already the palette's blood COLOUR (#9d2222),
   * so writing a number into it broke every rule painting with it — and the
   * worst casualty was `.wound-box.wounded`, the wound markers on the Slots
   * tab, which rendered TRANSPARENT from the first wound onwards. The markers
   * went blank at exactly the moment they started to matter. Verified in-world:
   * four wounded boxes all computed `rgba(0, 0, 0, 0)` instead of
   * `rgb(157, 34, 34)`, and the dead banner and the dungeon-turn bar lost their
   * fills with them.
   *
   * A class cannot collide with a colour. See the guard in
   * test/style-tokens.test.mjs.
   */
  _onRender(context, options) {
    super._onRender(context, options);
    const sys = this.actor.system;
    const ratio = sys.wounds.length ? sys.woundCount / sys.wounds.length : 0;
    this.element.classList.toggle("bleeding", ratio > 0);
    this.element.classList.toggle("dying", ratio >= 0.7);
  }

  /* -------------------------------------------- */

  #isCarryable(item) {
    return ["gear", "weapon", "armor", "spellbook"].includes(item.type);
  }

  /**
   * Build the render model for hand / belt / backpack as GRID CELLS.
   *
   * A multi-slot item is one cell spanning several columns, not several cells —
   * otherwise the continuation cells would shift the CSS grid and the card
   * would land in the wrong place. But every backpack slot keeps its own wound
   * checkbox even when a card lies across it (that is exactly how the printed
   * sheet works), so a spanning cell carries one wound toggle per slot it
   * covers.
   */
  #prepareContainers() {
    const sys = this.actor.system;
    const out = {};

    for (const [key, cfg] of Object.entries(CROWS.containers)) {
      if (key === "magic") continue;

      // slot index -> item starting there, and the set of covered indices.
      const starts = new Map();
      const covered = new Set();
      for (const item of this.actor.items) {
        const carried = item.system?.carried;
        if (carried?.container !== key || carried.index === null) continue;
        const span = Math.max(1, item.system.slots ?? 1);
        if (carried.index >= cfg.size) continue;
        starts.set(carried.index, { item, span: Math.min(span, cfg.size - carried.index) });
        for (let i = 0; i < span; i++) covered.add(carried.index + i);
      }

      const woundFor = (index) => ({
        index,
        number: index + 1,
        wounded: key === "backpack" ? sys.wounds[index] !== "" : false,
        kind: key === "backpack" ? sys.wounds[index] : "",
        woundable: !!cfg.woundable
      });

      const cells = [];
      for (let index = 0; index < cfg.size; index++) {
        const start = starts.get(index);
        if (!start) {
          // Skip cells swallowed by an earlier item's span.
          if (covered.has(index)) continue;
          cells.push({
            container: key,
            index,
            number: index + 1,
            span: 1,
            item: null,
            wounds: [woundFor(index)]
          });
          continue;
        }
        cells.push({
          container: key,
          index,
          number: index + 1,
          span: start.span,
          item: start.item,
          // One checkbox per covered slot, laid along the card.
          wounds: Array.from({ length: start.span }, (_, i) => woundFor(index + i))
        });
        index += start.span - 1;
      }

      out[key] = {
        key,
        label: game.i18n.localize(cfg.label),
        size: cfg.size,
        cells,
        /**
         * One row per container, so a multi-slot item never wraps.
         *
         * The printed sheet splits the backpack into two rows of five, but a
         * 2-slot item legally occupies slots 5 and 6 — which straddles that
         * break and would leave a gap in a wrapped CSS grid. A single row of
         * ten keeps adjacency visually true, which is the part that matters
         * mechanically.
         */
        columns: cfg.size
      };
    }
    return out;
  }

  #prepareMagicSlots() {
    return Object.entries(CROWS.magicSlots).map(([key, label]) => {
      const items = this.actor.items.filter(
        (i) => i.system?.carried?.container === "magic" && i.system.carried.magicSlot === key
      );
      return {
        key,
        label: game.i18n.localize(label),
        items,
        item: items[0] ?? null,
        // Two items in one slot means no rest and 1d6 wounds per turn (R p11).
        overloaded: items.length > 1
      };
    });
  }

  /**
   * Spend or restore one expertise use by clicking its pip.
   *
   * Pips fill left to right, so clicking pip i means "spend through i" when it
   * is still full and "give i back" when it is already spent — one control for
   * both directions, which is what let the row drop to a single number.
   */
  static async #onToggleExpertiseUse(event, target) {
    const key = target.dataset.expertise;
    const index = Number(target.dataset.index);
    const entry = this.actor.system.expertises[key];
    const spent = index < entry.spent ? index : index + 1;
    return this.actor.update({ [`system.expertises.${key}.spent`]: spent });
  }

  #prepareExpertises() {
    const sys = this.actor.system;
    const groups = {};

    for (const [key, cfg] of Object.entries(CROWS.expertises)) {
      const entry = sys.expertises[key];
      // Hide expertises the crow has never trained, unless editing.
      if (!entry.uses && !this.isEditable) continue;

      groups[cfg.category] ??= {
        key: cfg.category,
        label: game.i18n.localize(CROWS.expertiseCategories[cfg.category]),
        rows: []
      };
      groups[cfg.category].rows.push({
        key,
        label: game.i18n.localize(cfg.label),
        uses: entry.uses,
        spent: entry.spent,
        remaining: sys.expertiseRemaining[key],
        pips: Array.from({ length: entry.uses }, (_, i) => ({ spent: i < entry.spent }))
      });
    }

    for (const group of Object.values(groups)) group.rows.sort((a, b) => a.label.localeCompare(b.label));
    return Object.values(groups);
  }

  #prepareTraits() {
    const owned = this.actor.items.filter((i) => i.type === "trait");
    const trees = {};
    for (const trait of owned) {
      const tree = trait.system.tree;
      trees[tree] ??= { key: tree, label: game.i18n.localize(CROWS.traitTrees[tree] ?? tree), traits: [] };
      trees[tree].traits.push(trait);
    }
    for (const tree of Object.values(trees)) tree.traits.sort((a, b) => a.system.cost - b.system.cost);
    return Object.values(trees).sort((a, b) => a.label.localeCompare(b.label));
  }

  /* -------------------------------------------- */
  /*  Drag and drop                               */
  /* -------------------------------------------- */

  /** @inheritDoc */
  async _onDrop(event) {
    const data = foundry.applications.ux.TextEditor.getDragEventData(event);
    if (data.type !== "Item") return super._onDrop(event);

    const slot = event.target.closest(".crows-slot");
    const item = await Item.implementation.fromDropData(data);
    if (!item) return;

    // Moving an item already on this actor is a slot change, not a copy.
    if (item.parent === this.actor) {
      if (!slot) return;
      return this.#placeInSlot(item, slot);
    }

    const created = await this.actor.createEmbeddedDocuments("Item", [item.toObject()]);
    const newItem = created[0];
    if (slot) return this.#placeInSlot(newItem, slot);
    return newItem.stow?.();
  }

  async #placeInSlot(item, slotEl) {
    const container = slotEl.dataset.container;
    if (container === "magic") return item.moveTo("magic", null, { magicSlot: slotEl.dataset.magicSlot });
    return item.moveTo(container, Number(slotEl.dataset.index));
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static async #onRollCharacteristic(event, target) {
    return this.actor.rollTest({
      characteristic: target.dataset.characteristic,
      skipDialog: event.shiftKey
    });
  }

  static async #onUseItem(event, target) {
    const item = this.#itemFor(target);
    return item?.use({ skipDialog: event.shiftKey });
  }

  static async #onEditItem(event, target) {
    return this.#itemFor(target)?.sheet.render(true);
  }

  static async #onDeleteItem(event, target) {
    const item = this.#itemFor(target);
    if (!item) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("CROWS.DeleteItem") },
      content: `<p>${game.i18n.format("CROWS.DeleteItemConfirm", { name: item.name })}</p>`
    });
    if (ok) return item.delete();
  }

  static async #onToggleWound(event, target) {
    return this.actor.toggleWound(Number(target.dataset.index));
  }

  static async #onDrawFromPack(event, target) {
    return this.#itemFor(target)?.drawFromPack();
  }

  static async #onRollUsageDice(event, target) {
    const item = this.#itemFor(target);
    if (item) return this.actor.rollItemUsageDice(item, { reason: "manual" });
  }

  /** Exactly one suit of armor may be worn at a time (R p11). */
  static async #onWearArmor(event, target) {
    const item = this.#itemFor(target);
    if (!item || item.type !== "armor" || item.system.isShield) return;

    const updates = this.actor.items
      .filter((i) => i.type === "armor" && !i.system.isShield)
      .map((i) => ({ _id: i.id, "system.worn": i.id === item.id ? !item.system.worn : false }));
    return this.actor.updateEmbeddedDocuments("Item", updates);
  }

  static async #onRepairArmor(event, target) {
    return this.#itemFor(target)?.repair();
  }

  static async #onRest() {
    const { DialogV2 } = foundry.applications.api;
    const inMiasma = await DialogV2.confirm({
      window: { title: game.i18n.localize("CROWS.Rest") },
      content: `<p>${game.i18n.localize("CROWS.RestInMiasmaPrompt")}</p>`,
      yes: { label: game.i18n.localize("CROWS.InTheMiasma") },
      no: { label: game.i18n.localize("CROWS.Sheltered") }
    });
    await this.actor.rest({ inMiasma: !!inMiasma });
    return CrowSheet.#offerAdvancement(this.actor);
  }

  /**
   * A rest is when advancement becomes spendable, so a rest is when to offer it.
   *
   * Left to the player to remember, bonuses go untaken for sessions — the
   * number sat on the sheet for months doing nothing before there was even a
   * way to spend it. The rest is the one moment the rules point at.
   */
  static async #offerAdvancement(actor) {
    const { DialogV2 } = foundry.applications.api;
    const adv = actor.system.advancement;
    const owedBonuses = adv.available + adv.charAvailable;
    const spendableXP = actor.system.xp.available;
    if (!owedBonuses && spendableXP < CROWS.traitStartingCost) return;

    const lines = [];
    if (adv.available) lines.push(game.i18n.format("CROWS.OwedBonuses", { n: adv.available }));
    if (adv.charAvailable) lines.push(game.i18n.format("CROWS.OwedCharBonuses", { n: adv.charAvailable }));
    if (spendableXP >= CROWS.traitStartingCost) {
      lines.push(game.i18n.format("CROWS.OwedTraitXP", { xp: spendableXP }));
    }

    const open = await DialogV2.confirm({
      window: { title: game.i18n.localize("CROWS.Advancement") },
      content: `<p>${game.i18n.localize("CROWS.RestUnlocksAdvancement")}</p><ul><li>${lines.join(
        "</li><li>"
      )}</li></ul>`,
      yes: { label: game.i18n.localize(owedBonuses ? "CROWS.OpenAdvancement" : "CROWS.BrowseTraits") },
      no: { label: game.i18n.localize("CROWS.Later") },
      rejectClose: false
    });
    if (!open) return;

    if (owedBonuses) {
      const { AdvancementApp } = await import("./advancement.mjs");
      return new AdvancementApp({ actor }).render({ force: true });
    }
    const { TraitBrowser } = await import("./trait-browser.mjs");
    return new TraitBrowser({ actor }).render({ force: true });
  }

  static async #onEat() {
    return this.actor.eat();
  }

  static async #onBuyTrait() {
    const { ensureRested } = await import("./rest-gate.mjs");
    if (!(await ensureRested(this.actor))) return;
    const { TraitBrowser } = await import("./trait-browser.mjs");
    return new TraitBrowser({ actor: this.actor }).render({ force: true });
  }

  static async #onOpenAdvancement() {
    const { ensureRested } = await import("./rest-gate.mjs");
    if (!(await ensureRested(this.actor))) return;
    const { AdvancementApp } = await import("./advancement.mjs");
    return new AdvancementApp({ actor: this.actor }).render({ force: true });
  }

  static async #onOpenBuilder() {
    const { CrowBuilder } = await import("./builder.mjs");
    return new CrowBuilder({ actor: this.actor }).render({ force: true });
  }

  static async #onOpenTurnPanel() {
    const { DungeonTurnPanel } = await import("../system/dungeon-turn.mjs");
    return DungeonTurnPanel.show();
  }

  /**
   * Configure this actor's token ON THE CANVAS, as distinct from the prototype.
   *
   * The prototype is the template new tokens are stamped from; the placed token
   * is the thing actually standing in the dungeon. Editing one and expecting
   * the other to change is a standing Foundry trap, so both are offered
   * separately and only when they exist.
   */
  static async #onOpenPlacedToken() {
    const token = placedTokenFor(this.actor);
    if (!token) return ui.notifications.warn(game.i18n.localize("CROWS.NoPlacedToken"));
    return token.sheet.render(true);
  }

  /* -------------------------------------------- */

  #itemFor(target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    return id ? this.actor.items.get(id) : null;
  }
}
