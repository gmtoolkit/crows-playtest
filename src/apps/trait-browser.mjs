import { CROWS } from "../config.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Trait tree browser and purchaser (C p7).
 *
 * Purchase rules: a starting trait (top of a tree) costs 500 XP and needs no
 * prerequisite; anything else needs a trait you already own in the same tree
 * connected by a line. `prerequisites` lists those connections, and owning ANY
 * one of them unlocks the node — the trees branch, they do not require rows.
 */
export class TraitBrowser extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "crows-trait-browser",
    classes: ["crows", "trait-browser"],
    window: { title: "CROWS.BrowseTraits", icon: "fa-solid fa-diagram-project", resizable: true },
    position: { width: 720, height: 760 },
    actions: {
      selectTree: TraitBrowser.#onSelectTree,
      buy: TraitBrowser.#onBuy
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
    const owned = new Set(this.actor.items.filter((i) => i.type === "trait").map((i) => i.name));
    const available = this.actor.system.xp.available;

    const trees = Object.entries(CROWS.traitTrees).map(([key, label]) => ({
      key,
      label: game.i18n.localize(label),
      count: all.filter((t) => t.system.tree === key).length,
      ownedCount: all.filter((t) => t.system.tree === key && owned.has(t.name)).length,
      active: this.tree === key
    }));

    let rows = [];
    if (this.tree) {
      rows = all
        .filter((t) => t.system.tree === this.tree)
        .sort((a, b) => a.system.cost - b.system.cost || a.name.localeCompare(b.name))
        .map((t) => {
          const isOwned = owned.has(t.name);
          // A starting trait is always reachable; anything else needs one of
          // its prerequisites already owned in this tree.
          const unlocked = t.system.starting || t.system.prerequisites.some((p) => owned.has(p));
          return {
            id: t.id,
            uuid: t.uuid,
            name: t.name,
            cost: t.system.cost,
            starting: t.system.starting,
            description: t.system.description,
            prerequisites: t.system.prerequisites,
            owned: isOwned,
            unlocked,
            affordable: available >= t.system.cost,
            canBuy: !isOwned && unlocked && available >= t.system.cost
          };
        });
    }

    return {
      actor: this.actor,
      trees,
      tree: this.tree,
      treeLabel: this.tree ? game.i18n.localize(CROWS.traitTrees[this.tree]) : null,
      rows,
      available,
      hasTraits: all.length > 0
    };
  }

  /* -------------------------------------------- */

  static async #onSelectTree(event, target) {
    this.tree = target.dataset.tree;
    return this.render();
  }

  static async #onBuy(event, target) {
    const uuid = target.dataset.uuid;
    const doc = await fromUuid(uuid);
    if (!doc) return;

    const cost = doc.system.cost;
    if (this.actor.system.xp.available < cost) {
      return ui.notifications.warn(game.i18n.localize("CROWS.NotEnoughXP"));
    }
    if (this.actor.items.some((i) => i.type === "trait" && i.name === doc.name)) {
      return ui.notifications.warn(game.i18n.localize("CROWS.AlreadyOwned"));
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
}

export default TraitBrowser;
