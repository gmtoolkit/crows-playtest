import { CROWS } from "../config.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Choosing a background, as a gallery of cards.
 *
 * A background is the single biggest decision in creating a crow: it fixes a
 * characteristic at 2, sets Stamina, grants a starting trait, seeds every
 * expertise use and hands over a kit. A dropdown of 36 names asks a player to
 * choose between things it refuses to show them, so this lays each one out
 * with what it actually gives.
 *
 * It still only RECORDS the choice. Applying the statistics belongs to the
 * builder, because re-picking on a played crow would overwrite Stamina and
 * expertise uses they have since advanced.
 */
export class BackgroundPicker extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "crows-background-picker",
    classes: ["crows", "background-picker"],
    window: { title: "CROWS.PickBackground", icon: "fa-solid fa-scroll", resizable: true },
    position: { width: 860, height: 720 },
    actions: {
      choose: BackgroundPicker.#onChoose,
      roll: BackgroundPicker.#onRoll
    }
  };

  static PARTS = {
    body: { template: "systems/crows/templates/apps/background-picker.hbs", scrollable: [".bg-grid"] }
  };

  constructor(options = {}) {
    super(options);
    this.actor = options.actor;
    this.query = "";
  }

  async backgrounds() {
    if (this._all) return this._all;
    const docs = [];
    const pack = game.packs.get(`${CROWS.id}.backgrounds`);
    if (pack) docs.push(...(await pack.getDocuments()));
    docs.push(...game.items.filter((i) => i.type === "background"));
    this._all = docs.sort((a, b) => a.name.localeCompare(b.name));
    return this._all;
  }

  async _prepareContext() {
    const all = await this.backgrounds();
    const q = this.query.trim().toLowerCase();
    const current = this.actor?.system.biography.background;

    const cards = all
      .filter((b) => {
        if (!q) return true;
        const hay = [
          b.name,
          b.system.description,
          b.system.trait,
          ...b.system.expertises.map((e) => game.i18n.localize(CROWS.expertises[e.key]?.label ?? e.key)),
          ...b.system.equipment.map((e) => e.name)
        ].join(" ").toLowerCase();
        return hay.includes(q);
      })
      .map((b) => {
        const s = b.system;
        return {
          uuid: b.uuid,
          name: b.name,
          current: b.name === current,
          roll: `${s.roll.first}${s.roll.second}`,
          description: s.description,
          stamina: s.stamina,
          // A choice of characteristic is a real decision, so show it as one.
          characteristics: s.characteristicAt2.map((k) =>
            game.i18n.localize(CROWS.characteristics[k]?.label ?? k)
          ),
          hasChoice: s.characteristicAt2.length > 1,
          trait: s.trait,
          expertises: s.expertises.map((e) => ({
            label: game.i18n.localize(CROWS.expertises[e.key]?.label ?? e.key),
            uses: e.uses
          })),
          // The total is the honest comparison between backgrounds, and it
          // trades off against Stamina: 3 uses pairs with 9, 9 pairs with 5.
          totalUses: s.expertises.reduce((a, e) => a + e.uses, 0),
          equipment: s.equipment.map((e) => (e.quantity > 1 ? `${e.name} x${e.quantity}` : e.name)),
          spellbooks: s.spellbooks ?? [],
          bonusGold: s.bonusGold ?? 0
        };
      });

    return {
      actor: this.actor,
      cards,
      query: this.query,
      shown: cards.length,
      total: all.length,
      hasAny: all.length > 0
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const input = this.element.querySelector('input[name="query"]');
    if (!input) return;
    input.addEventListener("input", (ev) => {
      this.query = ev.currentTarget.value;
      this.render(false);
    });
    if (this.query) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  /* -------------------------------------------- */

  /** Roll 2d6 on the real table, which is how the book says to pick (C p1). */
  static async #onRoll() {
    const all = await this.backgrounds();
    const roll = await new Roll("1d6 + 1d6*0").evaluate(); // first die
    const first = roll.dice[0].results[0].result;
    const second = (await new Roll("1d6").evaluate()).total;

    const match = all.find((b) => b.system.roll.first === first && b.system.roll.second === second);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<div class="crows-rest">${game.i18n.format("CROWS.RolledBackground", {
        first, second, name: match?.name ?? "?"
      })}</div>`
    });

    if (!match) return;
    this.query = match.name;
    return this.render(false);
  }

  static async #onChoose(event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    const doc = await fromUuid(uuid);
    if (!doc) return;
    await this.actor.update({ "system.biography.background": doc.name });
    this.actor.sheet?.render(false);
    return this.render(false);
  }
}

export default BackgroundPicker;
