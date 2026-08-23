import { CROWS } from "../config.mjs";
import { PowerRoll } from "../dice/power-roll.mjs";
import { applyDamage, applyCreatureDamage, restRecovery, clearStarvation } from "../system/damage-math.mjs";
import { resolveUsageDice } from "../dice/tiers.mjs";

/**
 * The Actor document for both crows and creatures.
 *
 * Everything that mutates an actor in response to the rules lives here so the
 * sheets stay presentational and macros have a stable API
 * (`actor.rollTest(...)`, `actor.applyDamage(...)`, `actor.rest()`).
 */
export class CrowsActor extends Actor {
  /* -------------------------------------------- */
  /*  Creation defaults                           */
  /* -------------------------------------------- */

  /**
   * Give new actors a prototype token that matches how Crows actually works.
   *
   * Foundry defaults `sight.enabled` to false, so a freshly made crow walks
   * through walls' vision as if they were not there — the scene's token vision
   * and the walls are both correct, and nothing happens, because the TOKEN is
   * not computing vision at all.
   *
   * The important part is `range: 0` for crows. They have no darkvision:
   * "Without a proper light source, a crow can't effectively navigate their
   * environment, unlike dungeon denizens" (R p15). Range 0 does not mean blind
   * — Foundry shows a token whatever is lit within its line of sight — it
   * means a crow sees exactly as far as their torch reaches and no further,
   * which is the whole torch economy.
   *
   * Monsters are the stated exception: "Monsters have special senses that mean
   * darkness and dim light impose no penalties on them" (F p30), so they get
   * sight that does not depend on light.
   */
  async _preCreate(data, options, user) {
    const allowed = await super._preCreate(data, options, user);
    if (allowed === false) return false;

    // Respect anything the incoming data already specifies (compendium
    // imports, duplicates) rather than stamping over an authored token.
    const authored = data.prototypeToken ?? {};
    const proto = { sight: {}, ...foundry.utils.deepClone(authored) };

    if (this.type === "crow") {
      proto.actorLink ??= true;
      proto.disposition ??= CONST.TOKEN_DISPOSITIONS.FRIENDLY;
      proto.sight.enabled ??= true;
      proto.sight.range ??= 0; // no darkvision: they see only what is lit
      proto.sight.visionMode ??= "basic";

      /**
       * Default art with its own contrast.
       *
       * Foundry's stock `mystery-man.svg` is a PALE figure on transparency,
       * so with the room lights on it washes into a lit dungeon floor and a
       * player cannot find their own token. Ours carries a dark disc behind
       * the figure, so the contrast travels with the token instead of
       * depending on what it is standing on.
       *
       * Only applied when nothing else has been chosen — an import or a
       * duplicate keeps its own art.
       */
      if (!data.img || data.img === CONST.DEFAULT_TOKEN) this.updateSource({ img: CROWS.art.crowToken });
      proto.texture ??= {};
      if (!proto.texture.src || proto.texture.src === CONST.DEFAULT_TOKEN) {
        proto.texture.src = CROWS.art.crowToken;
      }
    } else if (this.type === "creature") {
      proto.actorLink ??= false;
      proto.disposition ??= this.system?.category === "monster"
        ? CONST.TOKEN_DISPOSITIONS.HOSTILE
        : CONST.TOKEN_DISPOSITIONS.NEUTRAL;
      proto.sight.enabled ??= true;
      // Monsters ignore darkness entirely; humans and animals need light like
      // a crow does.
      proto.sight.range ??= this.system?.category === "monster" ? CROWS.monsterSightRange : 0;
      proto.sight.visionMode ??= "basic";
    }

    this.updateSource({ prototypeToken: proto });
    return allowed;
  }

  /* -------------------------------------------- */
  /*  Carried light                               */
  /* -------------------------------------------- */

  /**
   * Push the crow's carried light onto their token(s).
   *
   * Crows have no darkvision, so the torch in your hand IS your vision. Making
   * the token's light follow the equipped light source means the torch economy
   * plays itself: draw a torch and the dark opens up, let its usage dice run
   * out at the end of a dungeon turn and it closes again, with no one having to
   * remember to edit a token.
   */
  async syncCarriedLight() {
    if (this.type !== "crow") return;

    const source = this.system.lightSource;
    const config = source
      ? {
          bright: source.bright,
          dim: source.dim,
          color: "#ff9d5c",
          alpha: 0.35,
          animation: { type: "torch", speed: 2, intensity: 2 }
        }
      : { bright: 0, dim: 0, animation: { type: null } };

    // The prototype carries it forward to tokens placed later.
    if (!foundry.utils.objectsEqual(this.prototypeToken.light.toObject?.() ?? {}, config)) {
      await this.update({ prototypeToken: { light: config } }, { render: false });
    }

    // Unlinked tokens keep their own copy, so update the placed ones too.
    for (const scene of game.scenes) {
      const updates = scene.tokens
        .filter((t) => t.actorId === this.id)
        .map((t) => ({ _id: t.id, light: config }));
      if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
    }
  }

  /* -------------------------------------------- */
  /*  Rolling                                     */
  /* -------------------------------------------- */

  /**
   * A plain test against a characteristic. Prompts for edges and banes unless
   * `skipDialog` is set (shift-click, or a macro that already knows).
   */
  async rollTest({ characteristic = "agility", expertise = null, label = null, skipDialog = false, ...rest } = {}) {
    let options = { characteristic, edges: 0, banes: 0, bonus: 0, ...rest };

    if (!skipDialog) {
      const answered = await PowerRoll.prompt({
        label: label ?? game.i18n.format("CROWS.TestOf", { name: this.name }),
        characteristic,
        ...options
      });
      if (!answered) return null;
      options = { ...options, ...answered };
    }

    return PowerRoll.roll({
      actor: this,
      label: label ?? game.i18n.format("CROWS.TestOf", { name: this.name }),
      type: "test",
      expertise,
      ...options
    });
  }

  /**
   * Attack with a weapon, a spell, or a creature's printed attack.
   *
   * The expertise eligible to improve the roll is derived from the item, not
   * chosen: only weapon expertises apply to weapon attacks and only
   * spellcasting expertises to castings (R p9).
   */
  async rollAttack(item, { skipDialog = false, ...rest } = {}) {
    if (!item) return null;
    const sys = item.system;

    const isCasting = item.type === "spellbook";
    const characteristic = isCasting ? "mind" : sys.characteristic;
    const expertise = isCasting ? sys.discipline : (CROWS.expertises[sys.group] ? sys.group : null);

    // Creature attacks add their printed bonus rather than a characteristic.
    const bonus = (rest.bonus ?? 0) + (sys.bonus ?? 0);

    let options = { characteristic, bonus, edges: 0, banes: 0, ...rest, bonus };

    if (!skipDialog) {
      const answered = await PowerRoll.prompt({
        label: item.name,
        characteristic,
        characteristicChoices: this.#characteristicChoices(characteristic),
        ...options
      });
      if (!answered) return null;
      options = { ...options, ...answered };
    }

    // Casting consumes the book's usage dice whether or not it lands (R p31).
    const outcome = await PowerRoll.roll({
      actor: this,
      item,
      label: item.name,
      type: isCasting ? "casting" : "attack",
      expertise,
      ...options
    });

    if (isCasting && outcome) await this.#resolveCasting(item, outcome.result);
    return outcome;
  }

  /** Expand an "either" characteristic into the two real choices for the dialog. */
  #characteristicChoices(characteristic) {
    switch (characteristic) {
      case "agilityOrStrength":
        return ["agility", "strength"];
      case "agilityOrMind":
        return ["agility", "mind"];
      case "mindOrStrength":
        return ["mind", "strength"];
      case "none":
        return ["none"];
      default:
        return [characteristic];
    }
  }

  /**
   * Post-casting bookkeeping: roll the book's usage dice (skipped on a crit),
   * then check for a backlash.
   */
  async #resolveCasting(item, result) {
    // "When you get a crit on a casting, you don't need to roll the spell's UD."
    if (!result.crit) await this.rollItemUsageDice(item, { reason: "cast" });

    // A doom always backlashes; any other tier 1 backlashes on a chaos roll of 1.
    let backlash = result.doom;
    if (!backlash && result.tier === 1) {
      const chaos = await new Roll(CROWS.chaosRoll.formula).evaluate();
      await chaos.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: this }),
        flavor: game.i18n.localize("CROWS.ChaosRoll")
      });
      backlash = chaos.total === CROWS.chaosRoll.backlashOn;
    }

    if (backlash) await this.rollBacklash(item.system.rank ?? 0);
  }

  /** Roll on the d100 + rank Backlashes table (R p32-35). */
  async rollBacklash(rank = 0) {
    const table = game.tables?.find((t) => t.getFlag(CROWS.id, "table") === "backlashes");
    const roll = await new Roll(`1d100 + ${rank}`).evaluate();

    if (!table) {
      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: this }),
        flavor: game.i18n.localize("CROWS.BacklashNoTable")
      });
      return roll;
    }
    return table.draw({ roll, displayChat: true });
  }

  /* -------------------------------------------- */
  /*  Damage                                      */
  /* -------------------------------------------- */

  /**
   * Apply damage through the full cascade.
   *
   * @param {number} amount
   * @param {object} [opts]
   * @param {boolean} [opts.piercing]  Bypasses Armor Defense (R p12).
   * @param {string} [opts.woundKind]
   * @param {string[]} [opts.adOrder]  Item ids naming which armor absorbs first.
   */
  async applyDamage(amount, { piercing = false, woundKind = "normal", adOrder = null } = {}) {
    if (this.type === "creature") return this.#applyCreatureDamage(amount, { piercing });

    const sys = this.system;

    // The crow chooses which armor loses AD first (R p12). Default to the
    // shield before the suit, since a shield is the cheaper thing to lose.
    let sources = sys.armorSources.map((i) => ({ id: i.id, value: i.system.ad.value }));
    if (adOrder) {
      const rank = new Map(adOrder.map((id, i) => [id, i]));
      sources = sources.sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99));
    } else {
      sources = sources.sort((a, b) => {
        const aShield = this.items.get(a.id)?.system.isShield ? 0 : 1;
        const bShield = this.items.get(b.id)?.system.isShield ? 0 : 1;
        return aShield - bShield;
      });
    }

    const outcome = applyDamage({
      damage: amount,
      piercing,
      adSources: sources,
      stamina: sys.stamina.value,
      wounds: sys.wounds,
      occupied: sys.occupiedBackpackSlots,
      woundKind
    });

    // Write armor depletion back to the individual items.
    const itemUpdates = Object.entries(outcome.adSpent).map(([id, spent]) => ({
      _id: id,
      "system.ad.value": Math.max(0, this.items.get(id).system.ad.value - spent)
    }));
    if (itemUpdates.length) await this.updateEmbeddedDocuments("Item", itemUpdates);

    const wounds = [...sys.wounds];
    for (const slot of outcome.woundSlots) wounds[slot] = woundKind;

    await this.update({ "system.stamina.value": outcome.staminaAfter, "system.wounds": wounds });
    await this.#announceDamage(amount, outcome, piercing);
    return outcome;
  }

  async #applyCreatureDamage(amount, { piercing = false } = {}) {
    const sys = this.system;
    const outcome = applyCreatureDamage({
      damage: amount,
      piercing,
      ad: sys.ad.value,
      stamina: sys.stamina.value,
      wounds: sys.wounds.value,
      woundMax: sys.wounds.max,
      usesWounds: sys.usesWounds
    });

    /**
     * "If you reduce a Ref-controlled creature to 0 Stamina, you can ask the
     * Ref if the damage could instead knock the creature unconscious. If the
     * Ref says it's okay, then the creature is reduced to 1 Stamina instead of
     * 0 and regains consciousness at the end of the dungeon turn." (R p12)
     *
     * Note what that means and what it is easy to get wrong: unconscious is a
     * ONE Stamina state, never zero. A creature left at 0 is dead, so knocking
     * one out has to stop the kill, not decorate it.
     *
     * Asked only of the Ref, only when the blow would actually be lethal, and
     * only for creatures that die at 0 rather than taking wounds.
     */
    let staminaAfter = outcome.staminaAfter;
    let spared = false;
    const askFirst = game.settings.get(CROWS.id, "askKnockUnconscious");
    if (askFirst && game.user.isGM && outcome.dead && !sys.usesWounds && staminaAfter <= 0) {
      spared = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("CROWS.KnockUnconscious") },
        content: `<p>${game.i18n.format("CROWS.KnockUnconsciousHint", { name: this.name })}</p>`,
        yes: { label: game.i18n.localize("CROWS.KnockOut") },
        no: { label: game.i18n.localize("CROWS.LetItDie") },
        rejectClose: false
      });
      if (spared) staminaAfter = 1;
    }

    await this.update({
      "system.ad.value": outcome.adAfter,
      "system.stamina.value": staminaAfter,
      "system.wounds.value": outcome.woundsAfter
    });

    if (spared) {
      await this.toggleStatusEffect("unconscious", { active: true });
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this }),
        content: `<div class="crows-damage">${game.i18n.format("CROWS.KnockedOut", {
          name: this.name
        })}</div>`
      });
    }

    await this.#announceDamage(amount, { ...outcome, dead: outcome.dead && !spared }, piercing);
    return { ...outcome, spared, staminaAfter };
  }

  async #announceDamage(amount, outcome, piercing) {
    const parts = [
      game.i18n.format("CROWS.TookDamage", { name: this.name, amount, piercing: piercing ? " (P)" : "" })
    ];
    if (outcome.absorbedByArmor) parts.push(game.i18n.format("CROWS.AbsorbedByArmor", { n: outcome.absorbedByArmor }));
    if (outcome.woundsTaken) parts.push(game.i18n.format("CROWS.WoundsTaken", { n: outcome.woundsTaken }));
    if (outcome.dead) parts.push(`<strong>${game.i18n.localize("CROWS.Dead")}</strong>`);

    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<div class="crows-damage">${parts.join(" ")}</div>`
    });
  }

  /* -------------------------------------------- */
  /*  Usage dice                                  */
  /* -------------------------------------------- */

  /** Roll one item's usage-dice pool, spending every die that shows 1 or 2. */
  async rollItemUsageDice(item, { reason = "dt" } = {}) {
    const ud = item.system?.ud;
    if (!ud || ud.value <= 0) return null;

    const roll = await new Roll(`${ud.value}d6`).evaluate();
    const faces = roll.dice[0].results.map((r) => r.result);
    const outcome = resolveUsageDice(faces, ud.value);

    await item.update({ "system.ud.value": outcome.remaining });

    const flavor = outcome.exhausted
      ? game.i18n.format("CROWS.UDExhausted", { item: item.name })
      : game.i18n.format("CROWS.UDRolled", { item: item.name, remaining: outcome.remaining });

    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: this }), flavor });
    return outcome;
  }

  /**
   * End-of-dungeon-turn bookkeeping for this actor: roll every DT-triggered
   * usage-dice pool, then clear conditions that expire with the turn.
   */
  async endDungeonTurn() {
    const results = [];
    for (const item of this.items) {
      if (item.system?.ud?.trigger === "dt" && item.system.ud.value > 0) {
        results.push({ item, outcome: await this.rollItemUsageDice(item) });
      }
    }

    // Overloaded magic slots inflict 1d6 wounds per turn (R p11).
    if (this.type === "crow" && this.system.magicSlotOverload.length) {
      const roll = await new Roll(CROWS.magicSlotOverloadWounds).evaluate();
      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: this }),
        flavor: game.i18n.localize("CROWS.MagicSlotOverload")
      });
      await this.addWounds(roll.total, "normal");
    }

    // Conditions that end at the end of a dungeon turn.
    const expiring = Object.entries(CROWS.conditions)
      .filter(([, c]) => c.endsAt === "dt")
      .map(([key]) => key);
    const toRemove = this.effects.filter((e) => expiring.includes(e.getFlag(CROWS.id, "condition")));
    if (toRemove.length) {
      await this.deleteEmbeddedDocuments(
        "ActiveEffect",
        toRemove.map((e) => e.id)
      );
    }

    return results;
  }

  /* -------------------------------------------- */
  /*  Wounds and rest                             */
  /* -------------------------------------------- */

  /** Add wounds directly, placing them by the same rules damage would use. */
  async addWounds(count, kind = "normal") {
    if (this.type !== "crow") {
      const next = Math.min(this.system.wounds.max, this.system.wounds.value + count);
      return this.update({ "system.wounds.value": next });
    }
    const outcome = applyDamage({
      damage: count,
      stamina: 0,
      wounds: this.system.wounds,
      occupied: this.system.occupiedBackpackSlots,
      woundKind: kind
    });
    const wounds = [...this.system.wounds];
    for (const slot of outcome.woundSlots) wounds[slot] = kind;
    return this.update({ "system.wounds": wounds });
  }

  /** Toggle a single backpack slot's wound, for hand-editing on the sheet. */
  async toggleWound(slot, kind = "normal") {
    if (this.type !== "crow") return null;
    const wounds = [...this.system.wounds];
    wounds[slot] = wounds[slot] === "" ? kind : "";
    return this.update({ "system.wounds": wounds });
  }

  /**
   * Finish a rest (R p14-15): full Stamina, one wound removed, expertise uses
   * restored, and rest-restored usage dice refilled.
   *
   * @param {object} [opts]
   * @param {boolean} [opts.inMiasma]  Withholds expertise recovery (R p27).
   * @param {number} [opts.woundsHealed]  2 if someone used Tend Wounds on them.
   */
  async rest({ inMiasma = false, woundsHealed = CROWS.rest.woundsHealed } = {}) {
    const updates = { "system.stamina.value": this.system.stamina.max };

    if (this.type === "crow") {
      const recovery = restRecovery(this.system.wounds, { woundsHealed });
      updates["system.wounds"] = recovery.wounds;

      // Resting in the Miasma restores everything EXCEPT expertise uses.
      if (!inMiasma) {
        for (const key of Object.keys(CROWS.expertises)) updates[`system.expertises.${key}.spent`] = 0;
      }
      // Prepare for Task lasts only until the next rest.
      updates["system.prepared.task"] = "";
      updates["system.prepared.bonus"] = 0;

      /**
       * Mark the TXP this rest settles.
       *
       * A rest is what makes earned XP spendable (C p6), so the rest is where
       * the mark belongs — not the advancement screen, which would let a crow
       * spend XP earned five minutes ago by opening a window.
       */
      updates["system.advancement.txpAtLastRest"] = this.system.xp.total;
    } else {
      updates["system.wounds.value"] = Math.max(0, this.system.wounds.value - woundsHealed);
    }

    await this.update(updates);

    // Refill rest-restored usage dice (spellbooks, and gear marked "Rest").
    const itemUpdates = this.items
      .filter((i) => i.system?.ud?.restore === "rest" && i.system.ud.value < i.system.ud.max)
      .map((i) => ({ _id: i.id, "system.ud.value": i.system.ud.max }));
    if (itemUpdates.length) await this.updateEmbeddedDocuments("Item", itemUpdates);

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<div class="crows-rest">${game.i18n.format(
        inMiasma ? "CROWS.RestedInMiasma" : "CROWS.Rested",
        { name: this.name }
      )}</div>`
    });
  }

  /**
   * Put the death marker on the token, or take it off.
   *
   * `system.dead` was already derived on both actor types and shown on the
   * sheet, but the map never said so — a monster at 0 Stamina looked exactly
   * like one at full health, which is the one place the table is actually
   * looking during a fight.
   *
   * Idempotent, so it can be called from any hook without stacking effects.
   * GM-only writes: a player's client must not try to stamp a monster.
   */
  async syncDeathMarker() {
    if (!game.user.isGM) return;
    const dead = !!this.system.dead;
    const has = this.statuses?.has?.("dead") ?? false;
    if (dead === has) return;

    await this.toggleStatusEffect("dead", { active: dead, overlay: true });

    // A dead combatant should stop taking turns.
    for (const combatant of game.combats?.contents.flatMap((c) => c.combatants.contents) ?? []) {
      if (combatant.actorId === this.id && combatant.defeated !== dead) {
        await combatant.update({ defeated: dead });
      }
    }
  }

  /** Eating clears every starvation wound at once (R p16). */
  async eat() {
    if (this.type !== "crow") return null;
    const { wounds, cleared } = clearStarvation(this.system.wounds);
    if (!cleared) return null;
    return this.update({ "system.wounds": wounds });
  }
}

export default CrowsActor;
