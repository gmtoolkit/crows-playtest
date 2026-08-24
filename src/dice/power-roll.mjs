import { CROWS } from "../config.mjs";
import { resolvePowerRoll, applyExpertise as applyExpertiseToResult, parseDamage, tidySigns } from "./tiers.mjs";

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
  static async prompt({
    label,
    characteristic,
    characteristicChoices = null,
    edges = 0,
    banes = 0,
    bonus = 0,
    situation = null
  }) {
    const chars = characteristicChoices ?? Object.keys(CROWS.characteristics);

    /**
     * The situation panel: every edge and bane the circumstances give you,
     * named, with its page.
     *
     * DETECTED ones arrive ticked because Foundry measured them — the light on
     * the target's square, an elevation difference, a status effect, a wall in
     * the way. JUDGEMENT ones arrive unticked because the answer is a Ref's:
     * whether that fog is light or heavy concealment, whether the barrel really
     * hides half of you, whether you and an ally are truly flanking. Ticking
     * those for you would be wrong often and invisibly.
     *
     * Every box adjusts the edge and bane counts below it, which stay editable
     * — the panel is a nudge, not a gate.
     */
    const rows = (situation?.modifiers ?? []).map((m) => {
      const sign = m.kind === "edge" ? "+" : "−";
      const cls = m.kind === "edge" ? "edge" : "bane";
      return `<label class="sit-row ${cls} ${m.detected ? "detected" : "judgement"}">
        <input type="checkbox" name="sit" value="${m.key}"
               data-kind="${m.kind}" data-count="${m.count}" ${m.active ? "checked" : ""}>
        <span class="sit-label">${game.i18n.localize(m.label)}</span>
        <span class="sit-value">${sign}${m.count}</span>
        <span class="sit-page">${m.page}</span>
      </label>`;
    });
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

        ${
          rows.length
            ? `<div class="crows-situation">
                 <p class="sit-head">
                   ${game.i18n.localize("CROWS.SituationTitle")}
                   ${situation?.target ? `<span class="sit-target">${situation.target}</span>` : ""}
                 </p>
                 ${rows.join("")}
                 <p class="hint">${game.i18n.localize("CROWS.SituationNote")}</p>
               </div>`
            : ""
        }
      </fieldset>`;

    const result = await DialogV2.prompt({
      window: { title: label ?? game.i18n.localize("CROWS.PowerRoll") },
      content,
      ok: {
        label: game.i18n.localize("CROWS.Roll"),
        callback: (_event, button) => new FormDataExtended(button.form).object
      },
      /**
       * Keep the counts in step with the boxes.
       *
       * The totals stay editable on purpose — a player may know about an edge
       * the canvas cannot see — so this SETS them from the ticks rather than
       * locking them, and only while the boxes are being touched.
       */
      render: (_event, dialog) => {
        const form = dialog.element.querySelector("form") ?? dialog.element;
        const boxes = [...form.querySelectorAll('input[name="sit"]')];
        if (!boxes.length) return;
        const sync = () => {
          let e = 0;
          let b = 0;
          for (const box of boxes) {
            if (!box.checked) continue;
            const n = Number(box.dataset.count) || 0;
            if (box.dataset.kind === "edge") e += n;
            else b += n;
          }
          form.querySelector('input[name="edges"]').value = String(e);
          form.querySelector('input[name="banes"]').value = String(b);
        };
        for (const box of boxes) box.addEventListener("change", sync);
        sync();
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

    await this.toMessage({ roll, result, actor, item, label, type, expertise, characteristic, mod });
    return { roll, result };
  }

  /* -------------------------------------------- */

  /**
   * Evaluate the damage a tier deals into an actual number.
   *
   * The printed text is not a formula ("2 + A or S", "8 dam*", "1d6 P dam"), so
   * it is parsed, `@mod` is bound to whichever characteristic was used, and the
   * result is rolled (tier damage may contain dice). Outcomes that are prose
   * rather than damage ("Push 1") yield null, and the chat card then offers no
   * Apply Damage button — a button that silently applies 0 is worse than none.
   */
  static async computeDamage({ item, tier, mod = 0, type }) {
    if (!item || tier < 2) return null;

    const sys = item.system;
    // Non-attack spells describe outcomes, not damage.
    if (item.type === "spellbook" && !sys.isAttack) return null;
    if (!["weapon", "spellbook", "attack"].includes(item.type)) return null;

    const parsed = parseDamage(sys[`tier${tier}`]);
    if (!parsed.formula) return null;

    // Bare substitution: the printed formula already carries its operator.
    const formula = tidySigns(parsed.formula.replace(/@mod/g, String(mod)));
    if (!Roll.validate(formula)) {
      console.warn(`crows | unparseable tier ${tier} damage on "${item.name}": ${sys[`tier${tier}`]}`);
      return null;
    }

    const roll = await new Roll(formula).evaluate();
    return {
      value: roll.total,
      formula,
      printed: sys[`tier${tier}`],
      // The item's own piercing flag wins; the printed "P" is a fallback for
      // stat blocks that were never given the flag.
      piercing: sys.piercing || parsed.piercing,
      note: parsed.note,
      rider: parsed.rider,
      hasDice: roll.dice.length > 0,
      roll
    };
  }

  /* -------------------------------------------- */

  /** Post the roll as a chat card carrying enough state to act on it later. */
  static async toMessage({ roll, result, actor, item, label, type, expertise, characteristic, mod = 0 }) {
    const remaining = expertise ? (actor?.system?.expertiseRemaining?.[expertise] ?? 0) : 0;
    const damage = await this.computeDamage({ item, tier: result.tier, mod, type });

    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/crows/templates/chat/power-roll.hbs",
      {
        label: label ?? game.i18n.localize("CROWS.PowerRoll"),
        actor,
        item,
        type,
        result,
        damage,
        characteristic,
        characteristicLabel: game.i18n.localize(CROWS.characteristics[characteristic]?.label ?? ""),
        tierText: this.tierText(result.tier, item, type),
        expertise,
        expertiseLabel: expertise ? game.i18n.localize(CROWS.expertises[expertise]?.label ?? expertise) : null,
        expertiseRemaining: remaining,
        canApplyExpertise: result.canApplyExpertise && remaining > 0,
        formula: roll.formula,
        faces: roll.dice[0].results.filter((r) => r.active).map((r) => r.result),
        // Who this was aimed at, and how the total got there.
        targets: this.targetNames(),
        breakdown: this.breakdown({ roll, result, mod, characteristic, actor })
      }
    );

    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      // Include the damage roll so Dice So Nice animates it and the dice are
      // inspectable, but only when it actually rolled dice.
      rolls: damage?.hasDice ? [roll, damage.roll] : [roll],
      flags: {
        crows: {
          // `label` and `mod` are needed to re-render this card after an
          // expertise is applied; without them the card loses its title and
          // recomputes damage against a modifier of 0.
          label: label ?? null,
          mod,
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
      /**
       * The PRINTED notation, never the stored one.
       *
       * `sys.tier3` holds "7 + @mod" — an internal placeholder — and putting it
       * straight on the card leaked "@mod" into chat above the resolved damage.
       * The models already derive `notationTier2`/`notationTier3`, which render
       * the same thing the card prints: "7 + S".
       */
      return sys[`notationTier${tier}`] || sys[`tier${tier}`] || null;
    }
    return null;
  }

  /**
   * How the total was reached, and what it had to beat.
   *
   * Crows has no DC to compare against — the roll lands in one of three bands
   * (<=11, 12-16, 17+), so "showing the work" means showing the bands and which
   * one the total fell in, plus every part that made up the total.
   */
  static breakdown({ roll, result, mod, characteristic, actor }) {
    const faces = roll.dice[0].results.filter((r) => r.active).map((r) => r.result);
    const parts = [{ key: "dice", label: `${faces.join(" + ")}`, value: faces.reduce((a, b) => a + b, 0) }];

    if (mod) {
      parts.push({
        key: "characteristic",
        label: game.i18n.localize(CROWS.characteristics[characteristic]?.abbr ?? "") || characteristic || "",
        value: mod
      });
    }
    if (result.modifier) {
      parts.push({ key: "edges", label: game.i18n.localize("CROWS.EdgeBaneModifier"), value: result.modifier });
    }

    return {
      parts,
      total: result.total,
      bands: [
        { tier: 1, label: `≤ ${CROWS.roll.tier2Min - 1}`, active: result.tier === 1 },
        { tier: 2, label: `${CROWS.roll.tier2Min}–${CROWS.roll.tier3Min - 1}`, active: result.tier === 2 },
        { tier: 3, label: `${CROWS.roll.tier3Min}+`, active: result.tier === 3 }
      ],
      // A crit or doom is read off the RAW dice, so the bands did not decide it.
      overridden: !!(result.crit || result.doom),
      rawTotal: faces.reduce((a, b) => a + b, 0)
    };
  }

  /** Whoever the roller had targeted when they rolled. */
  static targetNames() {
    return Array.from(game.user?.targets ?? []).map((t) => t.name).filter(Boolean);
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
    const mod = message.flags.crows.mod ?? 0;

    // The tier changed, so the damage changes with it — a tier-2 hit promoted
    // to tier 3 must show the tier-3 number, not the one it rolled with.
    const damage = await this.computeDamage({ item, tier: improved.tier, mod, type: data.type });

    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/crows/templates/chat/power-roll.hbs",
      {
        label: message.flags.crows.label ?? game.i18n.localize("CROWS.PowerRoll"),
        actor,
        item,
        type: data.type,
        result: improved,
        damage,
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
      "flags.crows.roll": {
        ...improved,
        type: data.type,
        expertise: key,
        characteristic: data.characteristic,
        actorUuid: data.actorUuid,
        itemUuid: data.itemUuid
      }
    });
  }
}

export default PowerRoll;
