import { CROWS } from "../config.mjs";
import { canTake, purseAfter, summarise, MODES, allowedContainers } from "../system/acquisition.mjs";
import { firstFit } from "../system/slots.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The equipment catalogue, opened from an empty inventory slot.
 *
 * Everything a crow can carry lives across four compendia, and finding a torch
 * meant knowing which one and opening the sidebar. Clicking the hole where the
 * item goes is the obvious gesture, so that is what opens this.
 *
 * A PLAYER MAY ALWAYS BROWSE. Whether they may take is what the world's
 * acquisition mode decides, and a refusal always says which refusal it is —
 * too expensive, no room, or the Ref hands these out — because each one has a
 * different fix and "nothing happened" has none.
 */
export class ItemBrowser extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "crows-item-browser",
    classes: ["crows", "item-browser"],
    window: { title: "CROWS.Catalogue", icon: "fa-solid fa-magnifying-glass", resizable: true },
    position: { width: 620, height: 700 },
    actions: {
      take: ItemBrowser.#onTake,
      inspect: ItemBrowser.#onInspect,
      setType: ItemBrowser.#onSetType
    }
  };

  static PARTS = {
    body: { template: "systems/crows/templates/apps/item-browser.hbs", scrollable: [".catalogue"] }
  };

  /** Compendia searched, in the order a player thinks about them. */
  static PACKS = ["weapons", "armor", "gear", "spellbooks"];

  constructor(options = {}) {
    super(options);
    this.actor = options.actor;
    /** The slot that was clicked, so a take lands where the player pointed. */
    this.target = options.target ?? null;
    this.query = "";
    this.type = "all";
  }

  get title() {
    return game.i18n.format("CROWS.CatalogueFor", { name: this.actor?.name ?? "" });
  }

  get mode() {
    return game.settings.get(CROWS.id, "itemAcquisition");
  }

  /* -------------------------------------------- */

  /**
   * Every catalogue item, from compendia plus anything the Ref authored.
   *
   * Cached per instance: four packs is a lot of documents to reload on every
   * keystroke, and the search filters in memory.
   */
  async catalogue() {
    if (this._catalogue) return this._catalogue;
    const docs = [];
    for (const name of ItemBrowser.PACKS) {
      const pack = game.packs.get(`${CROWS.id}.${name}`);
      if (pack) docs.push(...(await pack.getDocuments()));
    }
    // World items too, so homebrew appears beside the printed cards.
    docs.push(...game.items.filter((i) => ItemBrowser.PACKS.includes(`${i.type}s`)));
    this._catalogue = docs.sort((a, b) => a.name.localeCompare(b.name));
    return this._catalogue;
  }

  /**
   * The first legal home for an item, preferring the slot that was clicked.
   *
   * `firstFit` works on a placements array and answers for ONE container, so
   * this assembles the actor's current layout and walks the containers this
   * item is allowed in. Returning null is what makes "no room" a real refusal
   * rather than an item that silently lands nowhere.
   */
  #findSlot(item) {
    const placements = this.actor.items
      .filter((i) => i.system?.carried?.container && i.system.carried.index !== null)
      .map((i) => ({
        id: i.id,
        container: i.system.carried.container,
        index: i.system.carried.index,
        span: i.system.slots ?? 1,
        magicSlot: i.system.carried.magicSlot ?? null
      }));

    const span = item.system?.slots ?? 1;
    const order = allowedContainers(item);
    // The slot the player actually clicked goes first.
    if (this.target?.container && order.includes(this.target.container)) {
      order.sort((a, b) => (a === this.target.container ? -1 : b === this.target.container ? 1 : 0));
    }

    for (const container of order) {
      const index = firstFit({ placements, itemId: null, span, container });
      if (index !== null) return { container, index };
    }
    return null;
  }

  async _prepareContext() {
    const all = await this.catalogue();
    const sys = this.actor.system;
    const isGM = game.user.isGM;
    const isOwner = this.actor.isOwner;
    const q = this.query.trim().toLowerCase();

    const rows = all
      .filter((i) => this.type === "all" || i.type === this.type)
      .filter((i) => !q || i.name.toLowerCase().includes(q) ||
        (i.system.description ?? "").toLowerCase().includes(q))
      .map((item) => {
        const price = item.system.price ?? 0;
        // Where would it actually go? A take that cannot be placed is not a take.
        const fit = this.#findSlot(item);
        const verdict = canTake({
          isGM, mode: this.mode, coin: sys.coin, price, hasRoom: !!fit, isOwner
        });
        return {
          id: item.id, uuid: item.uuid, name: item.name, img: item.img, type: item.type,
          typeLabel: game.i18n.localize(`TYPES.Item.${item.type}`),
          price,
          summary: summarise(item),
          canTake: verdict.ok,
          reason: verdict.reason,
          /**
           * Built here, not in the template.
           *
           * Each refusal needs its own wording and its own numbers ("you are
           * 40 short" is actionable; "cannot take" is not), and Handlebars has
           * no concat helper to assemble the key from the reason.
           */
          blockedLabel: verdict.ok
            ? ""
            : game.i18n.format("CROWS.CannotTake." + verdict.reason, {
                name: item.name,
                gc: price,
                short: verdict.short ?? 0
              }),
          // The label has to say what pressing it does, and cost is part of that.
          takeLabel: isGM
            ? game.i18n.localize("CROWS.Grant")
            : game.i18n.format("CROWS.BuyFor", { gc: price })
        };
      });

    return {
      actor: this.actor,
      coin: sys.coin,
      isGM,
      mode: this.mode,
      modeIsPurchase: this.mode === MODES.purchase,
      query: this.query,
      type: this.type,
      types: [
        { key: "all", label: game.i18n.localize("CROWS.AllTypes") },
        ...ItemBrowser.PACKS.map((p) => {
          const t = p.replace(/s$/, "");
          return { key: t, label: game.i18n.localize(`TYPES.Item.${t}`) };
        })
      ],
      rows,
      total: all.length,
      shown: rows.length,
      targetLabel: this.target
        ? game.i18n.format("CROWS.IntoSlot", {
            container: game.i18n.localize(`CROWS.Container.${this.target.container}`),
            n: (this.target.index ?? 0) + 1
          })
        : null
    };
  }

  /* -------------------------------------------- */

  _onRender(context, options) {
    super._onRender(context, options);
    // Live search without a submit, and without re-querying the packs.
    const input = this.element.querySelector('input[name="query"]');
    if (input) {
      input.addEventListener("input", (ev) => {
        this.query = ev.currentTarget.value;
        this.render(false);
      });
      // Re-rendering steals focus; put it back where the player is typing.
      if (this.query) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
  }

  static #onSetType(event, target) {
    this.type = target.dataset.type;
    return this.render(false);
  }

  /** Open the item's own sheet, so a player can read a card they cannot buy. */
  static async #onInspect(event, target) {
    const doc = await fromUuid(target.closest("[data-uuid]").dataset.uuid);
    return doc?.sheet?.render(true);
  }

  /* -------------------------------------------- */

  static async #onTake(event, target) {
    const doc = await fromUuid(target.closest("[data-uuid]").dataset.uuid);
    if (!doc) return;

    const sys = this.actor.system;
    const price = doc.system.price ?? 0;
    const fit = this.#findSlot(doc);

    // Re-check at the moment of taking: coin and slots may have moved in
    // another window, and the button was rendered from a snapshot.
    const verdict = canTake({
      isGM: game.user.isGM,
      mode: this.mode,
      coin: sys.coin,
      price,
      hasRoom: !!fit,
      isOwner: this.actor.isOwner
    });
    if (!verdict.ok) {
      return ui.notifications.warn(
        game.i18n.format(`CROWS.CannotTake.${verdict.reason}`, {
          name: doc.name, gc: price, short: verdict.short ?? 0
        })
      );
    }

    const data = doc.toObject();
    delete data._id;
    data.system.carried = { container: fit.container, index: fit.index, magicSlot: null };

    await this.actor.createEmbeddedDocuments("Item", [data]);
    if (verdict.cost) await this.actor.update({ "system.coin": purseAfter(sys.coin, verdict.cost) });

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<div class="crows-rest">${game.i18n.format(
        verdict.cost ? "CROWS.BoughtItem" : "CROWS.GrantedItem",
        { name: this.actor.name, item: doc.name, gc: verdict.cost }
      )}</div>`
    });

    this.actor.sheet?.render(false);
    return this.render(false);
  }
}

export default ItemBrowser;
