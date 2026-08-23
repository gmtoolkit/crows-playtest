import { CROWS } from "../config.mjs";
import {
  validateAllocation,
  claimBonus,
  undoBonus,
  undoWouldStrand,
  characteristicCap,
  canRaiseCharacteristic,
  allCharacteristicsMaxed,
  raiseCharacteristic,
  undoCharacteristic
} from "../system/advancement.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/**
 * Taking an Expertise & Stamina bonus (C p6).
 *
 * This is the answer to "how do you train an expertise?" — you do not buy uses
 * with XP. XP buys traits and nothing else. Uses arrive when lifetime TXP
 * crosses a threshold and hands you a bonus, and a bonus is ONE pick from three
 * fixed packages: three uses to divide as you like, or +2 Stamina, or one use
 * and +1 Stamina.
 *
 * Before this existed the sheet simply showed how many bonuses TXP had earned,
 * under a tooltip reading "still to assign", and there was nothing to assign
 * them with: the number never moved, and raising an expertise was typing into a
 * box that answered to nothing.
 */
export class AdvancementApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "crows-advancement",
    classes: ["crows", "advancement-app"],
    window: { title: "CROWS.Advancement", icon: "fa-solid fa-arrow-up-right-dots", resizable: true },
    position: { width: 640, height: 720 },
    actions: {
      pickOption: AdvancementApp.#onPickOption,
      bump: AdvancementApp.#onBump,
      claim: AdvancementApp.#onClaim,
      undo: AdvancementApp.#onUndo,
      raiseCharacteristic: AdvancementApp.#onRaiseCharacteristic,
      undoCharacteristic: AdvancementApp.#onUndoCharacteristic
    }
  };

  static PARTS = {
    body: { template: "systems/crows/templates/apps/advancement.hbs", scrollable: [".adv-scroll"] }
  };

  constructor(options = {}) {
    super(options);
    this.actor = options.actor;
    /** The package being considered, and where its uses are going. */
    this.option = "expertise";
    this.allocation = {};
  }

  get title() {
    return game.i18n.format("CROWS.AdvancementFor", { name: this.actor?.name ?? "" });
  }

  /* -------------------------------------------- */

  async _prepareContext() {
    const sys = this.actor.system;
    const adv = sys.advancement;

    const options = Object.entries(CROWS.expertiseBonusOptions).map(([key, cfg]) => ({
      key,
      label: game.i18n.localize(`CROWS.BonusOption.${key}`),
      uses: cfg.uses,
      stamina: cfg.stamina,
      active: this.option === key
    }));

    const budget = CROWS.expertiseBonusOptions[this.option]?.uses ?? 0;
    const placed = Object.values(this.allocation).reduce((a, b) => a + (Number(b) || 0), 0);

    // Every expertise is offerable, including ones at zero: putting a use into
    // an expertise you have never trained is how the book says you acquire it.
    const rows = Object.entries(CROWS.expertises)
      .map(([key, cfg]) => {
        const current = sys.expertises[key]?.uses ?? 0;
        const add = Number(this.allocation[key]) || 0;
        return {
          key,
          label: game.i18n.localize(cfg.label),
          category: game.i18n.localize(CROWS.expertiseCategories[cfg.category]),
          current,
          add,
          after: current + add,
          atCap: current + add >= adv.maxUses,
          canAdd: placed < budget && current + add < adv.maxUses,
          canRemove: add > 0
        };
      })
      .sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));

    const check = validateAllocation({
      option: this.option,
      allocation: this.allocation,
      expertises: sys.expertises,
      maxUses: adv.maxUses
    });

    return {
      actor: this.actor,
      adv,
      txp: sys.xp.total,
      staminaMax: sys.stamina.max,
      options,
      rows,
      budget,
      placed,
      remaining: Math.max(0, budget - placed),
      canClaim: adv.available > 0 && check.ok,
      blockers: adv.available > 0 ? check.errors : [game.i18n.localize("CROWS.NoBonusOwed")],
      taken: adv.bonuses.map((b, i) => ({
        index: i,
        label: game.i18n.localize(`CROWS.BonusOption.${b.option}`),
        uses: Object.entries(b.uses ?? {})
          .map(([k, n]) => `${game.i18n.localize(CROWS.expertises[k]?.label ?? k)} +${n}`)
          .join(", "),
        stamina: b.stamina
      })),
      // Characteristics are a SEPARATE table with its own thresholds; the two
      // collide at 5,000 and 30,000 TXP, where a crow gets one of each.
      characteristics: Object.entries(CROWS.characteristics).map(([key, cfg]) => ({
        key,
        label: game.i18n.localize(cfg.label ?? key),
        value: sys.characteristics[key].value,
        atCap: !canRaiseCharacteristic(sys.characteristics[key].value),
        canRaise: adv.charAvailable > 0 && canRaiseCharacteristic(sys.characteristics[key].value)
      })),
      characteristicCap: characteristicCap(),
      charTaken: (adv.characteristics ?? []).map((key, i) => ({
        index: i,
        label: key ? game.i18n.localize(CROWS.characteristics[key]?.label ?? key) : game.i18n.localize("CROWS.StaminaInstead")
      })),
      // If every characteristic is already at the cap, the bonus converts
      // automatically — the book gives no choice, so this is not offered as one.
      allCharsMaxed: allCharacteristicsMaxed(sys.characteristics)
    };
  }

  /* -------------------------------------------- */

  static #onPickOption(event, target) {
    this.option = target.dataset.option;
    this.allocation = {};
    return this.render();
  }

  static #onBump(event, target) {
    const key = target.dataset.expertise;
    const delta = Number(target.dataset.delta);
    const next = (Number(this.allocation[key]) || 0) + delta;
    if (next <= 0) delete this.allocation[key];
    else this.allocation[key] = next;
    return this.render();
  }

  static async #onClaim() {
    const sys = this.actor.system;
    if (sys.advancement.available <= 0) {
      return ui.notifications.warn(game.i18n.localize("CROWS.NoBonusOwed"));
    }

    // Re-check at claim time: TXP or the sheet may have moved in another window.
    const check = validateAllocation({
      option: this.option,
      allocation: this.allocation,
      expertises: sys.expertises,
      maxUses: sys.advancement.maxUses
    });
    if (!check.ok) return ui.notifications.warn(check.errors[0]);

    const { update, entry } = claimBonus({
      option: this.option,
      allocation: this.allocation,
      expertises: sys.expertises,
      staminaMax: sys.stamina.max,
      staminaValue: sys.stamina.value
    });

    update["system.advancement.bonuses"] = [...sys.advancement.bonuses.map((b) => ({ ...b })), entry];
    await this.actor.update(update);

    const parts = [];
    if (Object.keys(entry.uses).length) {
      parts.push(
        Object.entries(entry.uses)
          .map(([k, n]) => `${game.i18n.localize(CROWS.expertises[k]?.label ?? k)} +${n}`)
          .join(", ")
      );
    }
    if (entry.stamina) parts.push(`${game.i18n.localize("CROWS.Stamina")} +${entry.stamina}`);

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<div class="crows-rest">${game.i18n.format("CROWS.TookBonus", {
        name: this.actor.name,
        detail: parts.join(" &middot; ")
      })}</div>`
    });

    this.allocation = {};
    this.actor.sheet?.render(false);
    return this.render();
  }

  static async #onUndo(event, target) {
    const index = Number(target.dataset.index);
    const sys = this.actor.system;
    const entry = sys.advancement.bonuses[index];
    if (!entry) return;

    const short = undoWouldStrand({ entry, expertises: sys.expertises });
    if (short.length) {
      return ui.notifications.warn(
        game.i18n.format("CROWS.UndoWouldStrand", {
          names: short.map((k) => game.i18n.localize(CROWS.expertises[k]?.label ?? k)).join(", ")
        })
      );
    }

    const ok = await DialogV2.confirm({
      window: { title: game.i18n.localize("CROWS.UndoBonus") },
      content: `<p>${game.i18n.localize("CROWS.UndoBonusConfirm")}</p>`
    });
    if (!ok) return;

    const update = undoBonus({
      entry,
      expertises: sys.expertises,
      staminaMax: sys.stamina.max,
      staminaValue: sys.stamina.value
    });
    update["system.advancement.bonuses"] = sys.advancement.bonuses
      .filter((_, i) => i !== index)
      .map((b) => ({ ...b }));

    await this.actor.update(update);
    this.actor.sheet?.render(false);
    return this.render();
  }

  /* -------------------------------------------- */

  static async #onRaiseCharacteristic(event, target) {
    const key = target.dataset.characteristic;
    const sys = this.actor.system;
    if (sys.advancement.charAvailable <= 0) {
      return ui.notifications.warn(game.i18n.localize("CROWS.NoCharacteristicBonusOwed"));
    }

    const result = raiseCharacteristic({
      key,
      characteristics: sys.characteristics,
      staminaMax: sys.stamina.max,
      staminaValue: sys.stamina.value
    });
    if (result.error) {
      return ui.notifications.warn(
        game.i18n.format("CROWS.CharacteristicAtCap", { cap: characteristicCap() })
      );
    }

    const update = { ...result.update };
    update["system.advancement.characteristics"] = [...sys.advancement.characteristics, result.entry];

    await this.actor.update(update);
    this.actor.sheet?.render(false);
    return this.render();
  }

  static async #onUndoCharacteristic(event, target) {
    const index = Number(target.dataset.index);
    const sys = this.actor.system;
    const entry = sys.advancement.characteristics[index];
    const update = undoCharacteristic({
      entry,
      characteristics: sys.characteristics,
      staminaMax: sys.stamina.max,
      staminaValue: sys.stamina.value
    });
    update["system.advancement.characteristics"] = sys.advancement.characteristics.filter((_, i) => i !== index);
    await this.actor.update(update);
    this.actor.sheet?.render(false);
    return this.render();
  }
}

export default AdvancementApp;
