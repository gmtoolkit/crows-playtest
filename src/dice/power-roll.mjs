import { CROWS } from "../config.mjs";
import { resolvePowerRoll, applyExpertise as applyExpertiseToResult } from "./tiers.mjs";

const { DialogV2 } = foundry.applications.api;

/**
 * Foundry integration for the power roll. The rules math lives in tiers.mjs and
 * is unit-tested there; this module only wires it to dice, dialogs, and chat.
 */
export class PowerRoll {
  /**
   * Ask for the situational modifiers before rolling. Returns null if cancelled.
   *
   * Edges and banes are counted, not toggled, because two of either changes
   * behaviour qualitatively (a tier shift instead of a number) and players need
   * to be able to say "I have three edges here".
   */
  static async prompt({ label, characteristic, characteristicChoices = null, edges = 0, banes = 0, bonus = 0 }) {
    const chars = characteristicChoices ?? Object.keys(CROWS.characteristics);
    const charOptions = chars
      .map(
        (key) =>
          `<option value="${key}" ${key === characteristic ? "selected" : ""}>${game.i18n.localize(
            CROWS.characteristics[key]?.label ?? key
          )}</option>`
      )
      .join("");

    const content = `
      <fieldset class="crows-roll-dialog">
        ${
          chars.length > 1
            ? `<div class="form-group">
                 <label>${game.i18n.localize("CROWS.Characteristic")}</label>
                 <select name="characteristic">${charOptions}</select>
               </div>`
            : `<input type="hidden" name="characteristic" value="${chars[0]}">`
        }
        <div class="form-group">
          <label>${game.i18n.localize("CROWS.Edges")}</label>
          <input type="number" name="edges" value="${edges}" min="0" step="1">
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("CROWS.Banes")}</label>
          <input type="number" name="banes" value="${banes}" min="0" step="1">
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("CROWS.Bonus")}</label>
          <input type="number" name="bonus" value="${bonus}" step="1">
        </div>
        <p class="hint">${game.i18n.localize("CROWS.EdgeBaneHint")}</p>
      </fieldset>`;

    const result = await DialogV2.prompt({
      window: { title: label ?? game.i18n.localize("CROWS.PowerRoll") },
      content,
      ok: {
        label: game.i18n.localize("CROWS.Roll"),
        callback: (_event, button) => new FormDataExtended(button.form).object
      },
      rejectClose: false
    });

    if (!result) return null;
    return {
      characteristic: result.characteristic ?? chars[0],
      edges: Number(result.edges) || 0,
      banes: Number(result.banes) || 0,
      bonus: Number(result.bonus) || 0
    };
  }

  /* -------------------------------------------- */

  /**
   * Execute a power roll and post the chat card.
   *
   * @param {object} opts
   * @param {Actor} opts.actor
   * @param {Item} [opts.item]           Weapon, spellbook, or creature attack.
   * @param {string} opts.characteristic Which characteristic to add.
   * @param {number} [opts.bonus]        Flat modifiers that are not edges.
   * @param {number} [opts.edges]
   * @param {number} [opts.banes]
   * @param {string} [opts.label]
   * @param {"test"|"attack"|"casting"|"resistance"} [opts.type]
   * @param {string} [opts.expertise]    Expertise key eligible to improve this.
   */
  static async roll({
    actor,
    item = null,
    characteristic = "agility",
    bonus = 0,
    edges = 0,
    banes = 0,
    label = null,
    type = "test",
    expertise = null
  } = {}) {
    const mod = actor?.system?.characteristicMod?.(characteristic) ?? 0;

    // A creature attack adds its printed bonus instead of a characteristic;
    // `characteristic: "none"` yields mod 0 and the bonus carries the number.
    const roll = new Roll(`${CROWS.roll.formula} + @mod + @bonus + @edge`, {
      mod,
      bonus,
      edge: 0 // replaced below once edges/banes resolve
    });

    // Resolve edges/banes first so the numeric part is baked into the roll the
    // player sees, rather than being applied invisibly afterwards.
    const preview = resolvePowerRoll({ dice: [0, 0], mod, bonus, edges, banes });
    roll.data.edge = preview.modifier;

    await roll.evaluate();

    const faces = roll.dice[0].results.filter((r) => r.active).map((r) => r.result);
    const result = resolvePowerRoll({ dice: faces, mod, bonus, edges, banes });

    // The Roll's own total and our computed total must agree, or the chat card
    // would show a number the tier was not derived from.
    if (roll.total !== result.total) {
      console.warn(
        `crows | power roll total mismatch: Roll=${roll.total} resolved=${result.total}. Trusting the resolved value.`
      );
    }

    await this.toMessage({ roll, result, actor, item, label, type, expertise, characteristic });
    return { roll, result };
  }

  /* -------------------------------------------- */

  /** Post the roll as a chat card carrying enough state to act on it later. */
  static async toMessage({ roll, result, actor, item, label, type, expertise, characteristic }) {
    const remaining = expertise ? (actor?.system?.expertiseRemaining?.[expertise] ?? 0) : 0;

    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/crows/templates/chat/power-roll.hbs",
      {
        label: label ?? game.i18n.localize("CROWS.PowerRoll"),
        actor,
        item,
        type,
        result,
        characteristic,
        characteristicLabel: game.i18n.localize(CROWS.characteristics[characteristic]?.label ?? ""),
        tierText: this.tierText(result.tier, item, type),
        expertise,
        expertiseLabel: expertise ? game.i18n.localize(CROWS.expertises[expertise]?.label ?? expertise) : null,
        expertiseRemaining: remaining,
        canApplyExpertise: result.canApplyExpertise && remaining > 0,
        formula: roll.formula,
        faces: roll.dice[0].results.filter((r) => r.active).map((r) => r.result)
      }
    );

    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      rolls: [roll],
      flags: {
        crows: {
          roll: {
            ...result,
            type,
            expertise,
            characteristic,
            actorUuid: actor?.uuid ?? null,
            itemUuid: item?.uuid ?? null
          }
        }
      }
    });
  }

  /* -------------------------------------------- */

  /** The printed outcome text for a tier, if the item supplies one. */
  static tierText(tier, item, type) {
    if (!item) return null;
    const sys = item.system;

    // Non-attack spells describe an outcome per tier rather than damage.
    if (item.type === "spellbook" && !sys.isAttack) {
      return sys.effects?.[`tier${tier}`] || null;
    }
    if (["weapon", "spellbook", "attack"].includes(item.type)) {
      if (tier === 1) return sys.tier1 || game.i18n.localize("CROWS.Miss");
      return sys[`tier${tier}`] || null;
    }
    return null;
  }

  /* -------------------------------------------- */

  /**
   * Spend one expertise use to improve a posted result by a tier.
   * Refuses on a doom, which the rules make immune to expertises.
   */
  static async applyExpertise(message) {
    const data = message.flags?.crows?.roll;
    if (!data) return;

    const actor = data.actorUuid ? await fromUuid(data.actorUuid) : null;
    if (!actor) return ui.notifications.warn(game.i18n.localize("CROWS.NoActorForRoll"));
    if (!actor.isOwner) return ui.notifications.warn(game.i18n.localize("CROWS.NotYourRoll"));

    const key = data.expertise;
    const remaining = actor.system.expertiseRemaining?.[key] ?? 0;
    if (!key || remaining <= 0) {
      return ui.notifications.warn(game.i18n.format("CROWS.NoExpertiseUses", { expertise: key ?? "?" }));
    }
    if (!data.canApplyExpertise) return ui.notifications.warn(game.i18n.localize("CROWS.CannotApplyExpertise"));

    const improved = applyExpertiseToResult(data);
    await actor.update({ [`system.expertises.${key}.spent`]: actor.system.expertises[key].spent + 1 });

    const item = data.itemUuid ? await fromUuid(data.itemUuid) : null;
    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/crows/templates/chat/power-roll.hbs",
      {
        label: message.flags.crows.label ?? game.i18n.localize("CROWS.PowerRoll"),
        actor,
        item,
        type: data.type,
        result: improved,
        characteristic: data.characteristic,
        characteristicLabel: game.i18n.localize(CROWS.characteristics[data.characteristic]?.label ?? ""),
        tierText: this.tierText(improved.tier, item, data.type),
        expertise: key,
        expertiseLabel: game.i18n.localize(CROWS.expertises[key]?.label ?? key),
        expertiseRemaining: remaining - 1,
        canApplyExpertise: false,
        expertiseApplied: true,
        formula: message.rolls?.[0]?.formula ?? "",
        faces: message.rolls?.[0]?.dice?.[0]?.results?.filter((r) => r.active).map((r) => r.result) ?? []
      }
    );

    return message.update({
      content,
      "flags.crows.roll": { ...improved, type: data.type, expertise: key, characteristic: data.characteristic, actorUuid: data.actorUuid, itemUuid: data.itemUuid }
    });
  }
}

export default PowerRoll;
