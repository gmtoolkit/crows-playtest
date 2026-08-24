import { CROWS } from "../config.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/**
 * Trait tree browser and purchaser (C p7).
 *
 * Laid out like the printed page: a 3x4 grid of trait boxes with the
 * connector bars drawn between rows, because the bars ARE the rule —
 * "You can only purchase a starting trait on a trait tree or a trait connected
 * by a line to another trait you already have on the same tree."
 *
 * The navigation follows how advancement actually goes: a crow invests in a
 * few trees over a career and returns to them, so every tree they have spent
 * XP in gets a chip showing that investment, and the plus opens the rest.
 */
export class TraitBrowser extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "crows-trait-browser",
    classes: ["crows", "trait-browser"],
    window: { title: "CROWS.BrowseTraits", icon: "fa-solid fa-diagram-project", resizable: true },
    position: { width: 860, height: 720 },
    actions: {
      pickTree: TraitBrowser.#onPickTree,
      selectTree: TraitBrowser.#onSelectTree,
      buy: TraitBrowser.#onBuy,
      refund: TraitBrowser.#onRefund,
      backToTrees: TraitBrowser.#onBackToTrees
    }
  };

  static PARTS = {
    body: { template: "systems/crows/templates/apps/trait-browser.hbs", scrollable: [".tree-body"] }
  };

  constructor(options = {}) {
    super(options);
    this.actor = options.actor;
    this.tree = options.tree ?? null;
  }

  get title() {
    return game.i18n.format("CROWS.TraitsFor", { name: this.actor?.name ?? "" });
  }

  /* -------------------------------------------- */

  async allTraits() {
    if (this._traits) return this._traits;
    const docs = [];
    const pack = game.packs.get("crows.traits");
    if (pack) docs.push(...(await pack.getDocuments()));
    docs.push(...game.items.filter((i) => i.type === "trait"));
    this._traits = docs;
    return docs;
  }

  /* -------------------------------------------- */

  async _prepareContext() {
    const all = await this.allTraits();
    const owned = new Map(
      this.actor.items.filter((i) => i.type === "trait").map((i) => [i.name, i])
    );
    const available = this.actor.system.xp.available;

    /* --- Chips: trees this crow has already invested in --------------- */

    const invested = new Map();
    for (const item of owned.values()) {
      const key = item.system.tree;
      invested.set(key, (invested.get(key) ?? 0) + item.system.cost);
    }

    const chips = [...invested.entries()]
      .map(([key, xp]) => ({
        key,
        label: game.i18n.localize(CROWS.traitTrees[key]?.label ?? key),
        xp,
        count: [...owned.values()].filter((i) => i.system.tree === key).length,
        active: this.tree === key
      }))
      .sort((a, b) => b.xp - a.xp);

    /* --- Trees still available to open -------------------------------- */

    const unopened = Object.entries(CROWS.traitTrees)
      .filter(([key]) => !invested.has(key))
      .map(([key, cfg]) => ({ key, label: game.i18n.localize(cfg.label) }))
      .sort((a, b) => a.label.localeCompare(b.label));

    /**
     * The gallery, which is what you land on.
     *
     * Every tree as a card carrying the book's own one-line specialization
     * (C p7's "Tree / Specialization" table), what you have already sunk into
     * it, and the cheapest thing you could buy there. Landing on "Pick a trait
     * tree." with nothing to pick from was a dead end.
     *
     * Invested trees sort FIRST, because a career is built by returning to a
     * tree; everything else follows alphabetically.
     */
    const byTree = new Map();
    for (const t of all) {
      if (!byTree.has(t.system.tree)) byTree.set(t.system.tree, []);
      byTree.get(t.system.tree).push(t);
    }

    const gallery = Object.entries(CROWS.traitTrees)
      .map(([key, cfg]) => {
        const inTree = byTree.get(key) ?? [];
        const ownedHere = inTree.filter((t) => owned.has(t.name));
        // What could actually be bought here right now: a starting trait, or
        // anything a trait already owned unlocks.
        const buyable = inTree.filter(
          (t) =>
            !owned.has(t.name) &&
            (t.system.starting || t.system.prerequisites.some((p) => owned.has(p)))
        );
        const cheapest = buyable.length ? Math.min(...buyable.map((t) => t.system.cost)) : null;
        return {
          key,
          label: game.i18n.localize(cfg.label),
          spec: game.i18n.localize(cfg.spec ?? ""),
          xp: invested.get(key) ?? 0,
          invested: invested.has(key),
          owned: ownedHere.length,
          total: inTree.length,
          cheapest,
          affordable: cheapest !== null && cheapest <= available
        };
      })
      .sort((a, b) => {
        if (a.invested !== b.invested) return a.invested ? -1 : 1;
        if (a.invested && b.invested) return b.xp - a.xp;
        return a.label.localeCompare(b.label);
      });

    const context = {
      actor: this.actor,
      available,
      totalInvested: [...invested.values()].reduce((a, b) => a + b, 0),
      chips,
      unopened,
      hasTraits: all.length > 0,
      gallery,
      tree: this.tree,
      treeLabel: this.tree ? game.i18n.localize(CROWS.traitTrees[this.tree]?.label ?? this.tree) : null
    };

    if (!this.tree) return context;

    /* --- The selected tree, as a grid --------------------------------- */

    const inTree = all.filter((t) => t.system.tree === this.tree);
    const rows = Math.max(0, ...inTree.map((t) => t.system.row)) + 1;
    const cols = Math.max(0, ...inTree.map((t) => t.system.column)) + 1;

    const cellFor = (t) => {
      const isOwned = owned.has(t.name);
      const unlocked = t.system.starting || t.system.prerequisites.some((p) => owned.has(p));
      const affordable = available >= t.system.cost;
      return {
        id: t.id,
        uuid: t.uuid,
        name: t.name,
        cost: t.cost ?? t.system.cost,
        starting: t.system.starting,
        description: t.system.description,
        prerequisites: t.system.prerequisites,
        row: t.system.row,
        column: t.system.column,
        owned: isOwned,
        unlocked,
        affordable,
        // Disabled states are distinct on purpose: "you have not opened the
        // path" and "you cannot pay for it" are different problems.
        locked: !isOwned && !unlocked,
        tooPoor: !isOwned && unlocked && !affordable,
        canBuy: !isOwned && unlocked && affordable
      };
    };

    context.grid = Array.from({ length: rows }, (_, r) => ({
      row: r,
      cost: inTree.find((t) => t.system.row === r)?.system.cost ?? 0,
      cells: Array.from({ length: cols }, (_, c) => {
        const t = inTree.find((x) => x.system.row === r && x.system.column === c);
        return t ? cellFor(t) : null;
      })
    }));

    /**
     * Connector bands between adjacent rows.
     *
     * Rendered as an SVG per gap using COLUMN INDICES as coordinates, so the
     * lines scale with the grid and need no pixel arithmetic. A link is drawn
     * lit when the crow owns the prerequisite, which makes the paths they have
     * actually opened readable at a glance.
     */
    context.bands = [];
    for (let r = 1; r < rows; r++) {
      const links = [];
      for (const t of inTree.filter((x) => x.system.row === r)) {
        for (const prereqName of t.system.prerequisites) {
          const from = inTree.find((x) => x.name === prereqName);
          if (!from) continue;
          links.push({
            from: from.system.column,
            to: t.system.column,
            lit: owned.has(prereqName)
          });
        }
      }
      context.bands.push({ afterRow: r - 1, links, cols });
    }

    context.cols = cols;
    return context;
  }

  /* -------------------------------------------- */

  /** Return to the gallery, so a player can spend across several trees. */
  static async #onBackToTrees() {
    this.tree = null;
    return this.render();
  }

  static async #onSelectTree(event, target) {
    this.tree = target.dataset.tree;
    return this.render();
  }

  /** The plus: open a tree this crow has not invested in yet. */
  static async #onPickTree() {
    const { unopened } = await this._prepareContext();
    if (!unopened.length) return ui.notifications.info(game.i18n.localize("CROWS.AllTreesOpened"));

    const options = unopened.map((t) => `<option value="${t.key}">${t.label}</option>`).join("");
    const result = await DialogV2.prompt({
      window: { title: game.i18n.localize("CROWS.SelectTraitTree") },
      content: `<div class="form-group"><label>${game.i18n.localize(
        "CROWS.Tree"
      )}</label><select name="tree" autofocus>${options}</select></div>`,
      ok: {
        label: game.i18n.localize("CROWS.Open"),
        callback: (_e, button) => new FormDataExtended(button.form).object.tree
      },
      rejectClose: false
    });

    if (!result) return;
    this.tree = result;
    return this.render();
  }

  /* -------------------------------------------- */

  static async #onBuy(event, target) {
    const doc = await fromUuid(target.dataset.uuid);
    if (!doc) return;

    const cost = doc.system.cost;
    const owned = this.actor.items.filter((i) => i.type === "trait");

    // Re-check at purchase time: the sheet may be stale if XP changed in
    // another window.
    if (owned.some((i) => i.name === doc.name)) {
      return ui.notifications.warn(game.i18n.localize("CROWS.AlreadyOwned"));
    }
    const unlocked =
      doc.system.starting || doc.system.prerequisites.some((p) => owned.some((i) => i.name === p));
    if (!unlocked) return ui.notifications.warn(game.i18n.localize("CROWS.TraitLocked"));
    if (this.actor.system.xp.available < cost) {
      return ui.notifications.warn(game.i18n.localize("CROWS.NotEnoughXP"));
    }

    await this.actor.createEmbeddedDocuments("Item", [doc.toObject()]);
    await this.actor.update({ "system.xp.spent": this.actor.system.xp.spent + cost });

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<div class="crows-rest">${game.i18n.format("CROWS.BoughtTrait", {
        name: this.actor.name,
        trait: doc.name,
        cost
      })}</div>`
    });

    return this.render();
  }

  /**
   * Give a trait back.
   *
   * Refused when another owned trait depends on it, so refunding cannot strand
   * a purchase behind a prerequisite the crow no longer has.
   */
  static async #onRefund(event, target) {
    const item = this.actor.items.get(target.dataset.itemId);
    if (!item) return;

    const dependents = this.actor.items.filter(
      (i) => i.type === "trait" && i.system.prerequisites.includes(item.name)
    );
    const stranded = dependents.filter(
      (d) =>
        !d.system.prerequisites.some(
          (p) => p !== item.name && this.actor.items.some((i) => i.type === "trait" && i.name === p)
        )
    );
    if (stranded.length) {
      return ui.notifications.warn(
        game.i18n.format("CROWS.TraitHasDependents", { names: stranded.map((d) => d.name).join(", ") })
      );
    }

    const ok = await DialogV2.confirm({
      window: { title: game.i18n.localize("CROWS.RefundTrait") },
      content: `<p>${game.i18n.format("CROWS.RefundTraitConfirm", {
        trait: item.name,
        cost: item.system.cost
      })}</p>`
    });
    if (!ok) return;

    await this.actor.update({
      "system.xp.spent": Math.max(0, this.actor.system.xp.spent - item.system.cost)
    });
    await item.delete();
    return this.render();
  }
}

export default TraitBrowser;
