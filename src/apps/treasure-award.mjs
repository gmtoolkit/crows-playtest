import { CROWS } from "../config.mjs";
import { splitTreasure, thresholdsCrossed, qualifies, EXCLUSIONS } from "../system/treasure.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Awarding recovered treasure, which is how a crow earns XP (C p6).
 *
 * The Ref names the haul's value, ticks off any of the book's exclusions, and
 * every crow in the party gains value ÷ party size. Crossing a threshold is
 * announced right there, in chat, at the moment it happens — because that is
 * the level-up, and before this existed nothing in the system marked it. The
 * rest then only says "you are owed three", which is what the rules actually
 * describe.
 *
 * The exclusions are ticked by hand on purpose. Every one of them is about
 * PROVENANCE — purchased, crafted, taken from an innocent, an ally's own gear,
 * recovered inside a village — and no item field records that. Hooking XP to
 * "an item entered an inventory" would pay a crow for buying a torch.
 */
export class TreasureAward extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "crows-treasure-award",
    classes: ["crows", "treasure-award"],
    tag: "form",
    window: { title: "CROWS.AwardTreasure", icon: "fa-solid fa-sack-dollar" },
    position: { width: 460, height: "auto" },
    form: { handler: TreasureAward.#onSubmit, closeOnSubmit: true },
    actions: { toggleCrow: TreasureAward.#onToggleCrow }
  };

  static PARTS = {
    body: { template: "systems/crows/templates/apps/treasure-award.hbs" }
  };

  constructor(options = {}) {
    super(options);
    /** Crows sharing the haul; defaults to every player-owned crow. */
    this.included = null;
  }

  /** Every crow that could take a share. */
  get partyCrows() {
    return game.actors.filter((a) => a.type === "crow" && a.hasPlayerOwner);
  }

  async _prepareContext() {
    this.included ??= new Set(this.partyCrows.map((a) => a.id));
    const crows = this.partyCrows.map((a) => ({
      id: a.id,
      name: a.name,
      img: a.img,
      txp: a.system.xp.total,
      included: this.included.has(a.id)
    }));

    return {
      crows,
      partySize: crows.filter((c) => c.included).length,
      exclusions: EXCLUSIONS.map((key) => ({ key, label: `CROWS.Exclusion.${key}` }))
    };
  }

  static #onToggleCrow(event, target) {
    const id = target.dataset.actorId;
    if (this.included.has(id)) this.included.delete(id);
    else this.included.add(id);
    return this.render(false);
  }

  /* -------------------------------------------- */

  static async #onSubmit(event, form, formData) {
    const data = formData.object;
    const value = Number(data.value) || 0;
    const label = (data.label ?? "").trim();

    const flags = Object.fromEntries(EXCLUSIONS.map((k) => [k, !!data[k]]));
    if (!qualifies(flags)) {
      return ui.notifications.warn(game.i18n.localize("CROWS.TreasureExcluded"));
    }

    const crows = this.partyCrows.filter((a) => this.included.has(a.id));
    if (!crows.length) return ui.notifications.warn(game.i18n.localize("CROWS.NoCrowsSelected"));

    const split = splitTreasure(value, crows.length);
    if (!split.each) return ui.notifications.warn(game.i18n.localize("CROWS.HaulTooSmall"));

    const lines = [];
    for (const actor of crows) {
      const before = actor.system.xp.total;
      const after = before + split.each;
      await actor.update({ "system.xp.total": after });

      const crossed = thresholdsCrossed(before, after);
      let line = `<strong>${actor.name}</strong> +${split.each} XP <span class="muted">(${after} total)</span>`;
      if (crossed.bonuses) {
        line += `<br><span class="levelled">${game.i18n.format("CROWS.CrossedThreshold", {
          n: crossed.bonuses
        })}</span>`;
      }
      if (crossed.characteristics) {
        line += `<br><span class="levelled">${game.i18n.format("CROWS.CrossedCharThreshold", {
          n: crossed.characteristics
        })}</span>`;
      }
      if (crossed.maxUsesRose) {
        line += `<br><span class="levelled">${game.i18n.format("CROWS.MaxUsesRose", {
          n: crossed.newMaxUses
        })}</span>`;
      }
      lines.push(line);
    }

    const remainder = split.remainder
      ? `<p class="muted">${game.i18n.format("CROWS.HaulRemainder", { gc: split.remainder })}</p>`
      : "";

    await ChatMessage.create({
      content:
        `<div class="crows-treasure">` +
        `<h4>${game.i18n.format("CROWS.TreasureRecovered", {
          label: label || game.i18n.localize("CROWS.Treasure"),
          gc: split.total
        })}</h4>` +
        `<p class="muted">${game.i18n.format("CROWS.SplitBetween", {
          n: split.partySize,
          each: split.each
        })}</p>` +
        `<ul><li>${lines.join("</li><li>")}</li></ul>` +
        remainder +
        `<p class="hint">${game.i18n.localize("CROWS.ClaimAtRest")}</p>` +
        `</div>`
    });
  }
}

export default TreasureAward;
