import { CROWS } from "../config.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Crow creation (C p1).
 *
 * The book's procedure is four steps: roll 2d6 for a background, record its
 * statistics, take its equipment cards, and make a village connection. This
 * walks that, and does the tedious part — placing a dozen starting cards into
 * legal inventory slots — automatically.
 *
 * Backgrounds are read from the `crows.backgrounds` compendium, falling back to
 * world items so a Ref can author their own.
 *
 * TWO RULINGS STILL TO IMPLEMENT HERE, both waiting on that compendium:
 *
 * 1. Once backgrounds set starting expertise uses, the raw `uses` box on the
 *    sheet becomes read-only for everyone (see expertise-row.hbs).
 * 2. REPLACEMENT CROWS GET FULL CATCH-UP. C p7 lets the Ref rule that a new PC
 *    after a death "starts with XP equal to the lowest TXP of a crow already in
 *    the party". The book says XP, not TXP, and never says whether that
 *    confers the advancement bonuses that much TXP would have earned. Cliff
 *    ruled 2026-08-23 that it does: the replacement arrives a peer of the
 *    party, with the expertise/Stamina and characteristic bonuses already owed
 *    to them, not merely trait XP to spend.
 */
export class CrowBuilder extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "crows-builder",
    classes: ["crows", "builder"],
    tag: "form",
    window: { title: "CROWS.Builder", icon: "fa-solid fa-wand-magic-sparkles", resizable: true },
    position: { width: 620, height: 720 },
    actions: {
      rollBackground: CrowBuilder.#onRollBackground,
      pickBackground: CrowBuilder.#onPickBackground,
      chooseSpread: CrowBuilder.#onChooseSpread,
      chooseAt2: CrowBuilder.#onChooseAt2,
      apply: CrowBuilder.#onApply,
      back: CrowBuilder.#onBack
    }
  };

  static PARTS = {
    body: { template: "systems/crows/templates/apps/builder.hbs", scrollable: [""] }
  };

  constructor(options = {}) {
    super(options);
    this.actor = options.actor;
    /**
     * The crow being built, NOT called `state`.
     *
     * ApplicationV2 defines `state` as a read-only getter, so `this.state = {}`
     * threw in the constructor and the builder simply never opened — the button
     * did nothing, with the error swallowed as an unhandled rejection. Third
     * name collision of this kind in this system; the others were
     * `--crows-blood` (a palette colour overwritten with a number) and
     * `advancement` (a stored field replaced by a derived object).
     */
    this.draft = {
      step: "background",
      background: null,
      /** Which characteristic the background raises to 2. */
      at2: null,
      /** Index into CROWS.creation.characteristicSpreads for the other two. */
      spreadIndex: 0,
      /** Which of the remaining two characteristics gets the higher value. */
      spreadOrder: null,
      rolled: null
    };
  }

  /* -------------------------------------------- */

  /** Every background document available, from the compendium plus the world. */
  async backgrounds() {
    if (this._backgrounds) return this._backgrounds;

    const docs = [];
    const pack = game.packs.get("crows.backgrounds");
    if (pack) docs.push(...(await pack.getDocuments()));
    docs.push(...game.items.filter((i) => i.type === "background"));

    this._backgrounds = docs.sort((a, b) => a.name.localeCompare(b.name));
    return this._backgrounds;
  }

  /* -------------------------------------------- */

  async _prepareContext() {
    const backgrounds = await this.backgrounds();
    const bg = this.draft.background;

    const context = {
      actor: this.actor,
      draft: this.draft,
      backgrounds,
      hasBackgrounds: backgrounds.length > 0,
      CROWS
    };

    if (bg) {
      const sys = bg.system;
      context.chosen = {
        doc: bg,
        stamina: sys.stamina,
        trait: sys.trait,
        expertises: sys.expertises.map((e) => ({
          key: e.key,
          uses: e.uses,
          label: game.i18n.localize(CROWS.expertises[e.key]?.label ?? e.key)
        })),
        equipment: sys.equipment,
        spellbooks: sys.spellbooks,
        bonusGold: sys.bonusGold,
        at2Options: sys.characteristicAt2.map((key) => ({
          key,
          label: game.i18n.localize(CROWS.characteristics[key].label)
        })),
        /** A single option means the background dictates it; auto-select. */
        at2Fixed: sys.characteristicAt2.length === 1
      };

      context.spreads = CROWS.creation.characteristicSpreads.map((pair, index) => ({
        index,
        label: `${pair[0] >= 0 ? "+" : ""}${pair[0]} / ${pair[1] >= 0 ? "+" : ""}${pair[1]}`,
        pair,
        selected: this.draft.spreadIndex === index
      }));

      context.remaining = Object.keys(CROWS.characteristics)
        .filter((k) => k !== this.draft.at2)
        .map((key) => ({ key, label: game.i18n.localize(CROWS.characteristics[key].label) }));

      context.preview = this.#previewCharacteristics();
    }

    return context;
  }

  /**
   * The characteristic spread this configuration produces.
   * The background sets one to 2; the other two take the chosen pair.
   */
  #previewCharacteristics() {
    const values = { agility: 0, mind: 0, strength: 0 };
    if (!this.draft.at2) return values;

    values[this.draft.at2] = 2;
    const others = Object.keys(CROWS.characteristics).filter((k) => k !== this.draft.at2);
    const pair = CROWS.creation.characteristicSpreads[this.draft.spreadIndex];

    // spreadOrder names which of the two remaining gets the FIRST (higher) value.
    const first = this.draft.spreadOrder ?? others[0];
    const second = others.find((k) => k !== first);
    values[first] = pair[0];
    values[second] = pair[1];
    return values;
  }

  /* -------------------------------------------- */

  static async #onRollBackground() {
    const backgrounds = await this.backgrounds();
    if (!backgrounds.length) return ui.notifications.warn(game.i18n.localize("CROWS.NoBackgrounds"));

    // The real table is 2d6 read as two separate columns (C p1).
    const roll = await new Roll("2d6").evaluate();
    const [first, second] = roll.dice[0].results.map((r) => r.result);
    await roll.toMessage({ flavor: game.i18n.localize("CROWS.RollingBackground") });

    const match = backgrounds.find((b) => b.system.roll.first === first && b.system.roll.second === second);
    this.draft.rolled = { first, second };
    if (match) this.#selectBackground(match);
    else ui.notifications.warn(game.i18n.format("CROWS.NoBackgroundAt", { first, second }));
    return this.render();
  }

  static async #onPickBackground(event, target) {
    const backgrounds = await this.backgrounds();
    const bg = backgrounds.find((b) => b.id === target.dataset.backgroundId);
    if (bg) this.#selectBackground(bg);
    return this.render();
  }

  #selectBackground(bg) {
    this.draft.background = bg;
    this.draft.step = "characteristics";
    // Backgrounds with no choice preselect themselves.
    this.draft.at2 = bg.system.characteristicAt2.length === 1 ? bg.system.characteristicAt2[0] : null;
    this.draft.spreadOrder = null;
  }

  static async #onChooseAt2(event, target) {
    this.draft.at2 = target.dataset.characteristic;
    this.draft.spreadOrder = null;
    return this.render();
  }

  static async #onChooseSpread(event, target) {
    if (target.dataset.spreadIndex !== undefined) this.draft.spreadIndex = Number(target.dataset.spreadIndex);
    if (target.dataset.first) this.draft.spreadOrder = target.dataset.first;
    return this.render();
  }

  static async #onBack() {
    this.draft.step = "background";
    this.draft.background = null;
    return this.render();
  }

  /* -------------------------------------------- */

  /** Write the background onto the actor and place its starting kit. */
  static async #onApply() {
    const bg = this.draft.background;
    if (!bg) return;
    if (!this.draft.at2) return ui.notifications.warn(game.i18n.localize("CROWS.PickCharacteristic"));

    const sys = bg.system;
    const chars = this.#previewCharacteristics();

    const updates = {
      "system.stamina.value": sys.stamina,
      "system.stamina.max": sys.stamina,
      "system.speed.base": CROWS.creation.startingSpeed,
      "system.biography.background": bg.name
    };
    for (const [key, value] of Object.entries(chars)) updates[`system.characteristics.${key}.value`] = value;

    // Expertise uses are additive over whatever the actor already has, so a
    // half-built crow does not lose training when a background is reapplied.
    for (const e of sys.expertises) {
      const current = this.actor.system.expertises[e.key]?.uses ?? 0;
      updates[`system.expertises.${e.key}.uses`] = Math.max(current, e.uses);
    }

    // Starting coin: 3d6 plus whatever the background adds.
    const goldRoll = await new Roll(CROWS.creation.startingGold).evaluate();
    updates["system.coin"] = goldRoll.total + sys.bonusGold;
    await goldRoll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: game.i18n.localize("CROWS.StartingGold")
    });

    await this.actor.update(updates);

    // Grant the starting trait and the kit.
    await this.#grantTrait(sys.trait);
    await this.#grantEquipment(sys);

    ui.notifications.info(game.i18n.format("CROWS.BuilderDone", { name: this.actor.name, background: bg.name }));
    this.close();
    return this.actor.sheet.render(true);
  }

  async #grantTrait(traitName) {
    if (!traitName) return;
    // Background trait names print as "Tree: Trait" (e.g. "Armor: Stalwart").
    const bare = traitName.includes(":") ? traitName.split(":").pop().trim() : traitName;

    const pack = game.packs.get("crows.traits");
    const docs = pack ? await pack.getDocuments() : [];
    const found =
      docs.find((d) => d.name === bare) ??
      docs.find((d) => d.name.toLowerCase() === bare.toLowerCase()) ??
      game.items.find((i) => i.type === "trait" && i.name === bare);

    if (!found) {
      ui.notifications.warn(game.i18n.format("CROWS.TraitNotFound", { name: traitName }));
      return;
    }
    if (this.actor.items.some((i) => i.type === "trait" && i.name === found.name)) return;
    await this.actor.createEmbeddedDocuments("Item", [found.toObject()]);
  }

  /**
   * Create the kit and stow it. Everything is stowed rather than left loose,
   * because "which slot" is the interesting decision and starting from a legal
   * arrangement beats starting from a pile.
   */
  async #grantEquipment(sys) {
    const wanted = [
      // Every crow starts with these regardless of background (C p1).
      ...CROWS.creation.freeEquipment.map((name) => ({ name: stripCount(name), quantity: countIn(name) })),
      ...sys.equipment.map((e) => ({ name: e.name, quantity: e.quantity })),
      ...sys.spellbooks.map((name) => ({ name, quantity: 1, spellbook: true }))
    ];

    const created = [];
    const missing = [];

    for (const entry of wanted) {
      const doc = await this.#findItem(entry.name, entry.spellbook);
      if (!doc) {
        missing.push(entry.name);
        continue;
      }
      const data = doc.toObject();
      data.system.quantity = entry.quantity;
      created.push(data);
    }

    if (created.length) {
      const docs = await this.actor.createEmbeddedDocuments("Item", created);
      // Stow sequentially: each placement must see the previous one to avoid
      // two items claiming the same slot.
      for (const doc of docs) await doc.stow();
    }

    if (missing.length) {
      ui.notifications.warn(game.i18n.format("CROWS.KitMissing", { names: missing.join(", ") }));
    }
  }

  /** Look an item up by name across the content packs, then the world. */
  async #findItem(name, spellbookOnly = false) {
    const packNames = spellbookOnly ? ["crows.spellbooks"] : ["crows.gear", "crows.weapons", "crows.armor", "crows.spellbooks"];

    for (const key of packNames) {
      const pack = game.packs.get(key);
      if (!pack) continue;
      const index = await pack.getIndex();
      const hit =
        index.find((e) => e.name.toLowerCase() === name.toLowerCase()) ??
        index.find((e) => e.name.toLowerCase().startsWith(name.toLowerCase()));
      if (hit) return pack.getDocument(hit._id);
    }

    return game.items.find((i) => i.name.toLowerCase() === name.toLowerCase()) ?? null;
  }
}

/** "rations (6)" -> 6 */
function countIn(label) {
  const m = /\((\d+)\)/.exec(label);
  return m ? Number(m[1]) : 1;
}

/** "rations (6)" -> "rations" */
function stripCount(label) {
  return label.replace(/\s*\(\d+\)\s*$/, "").trim();
}

export default CrowBuilder;
