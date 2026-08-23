import { CROWS } from "../config.mjs";
import {
  earnedBonuses,
  earnedCharacteristicBonuses,
  grantedTotals,
  backgroundUses
} from "../system/advancement.mjs";

const fields = foundry.data.fields;

/**
 * A crow — the player character.
 *
 * The design centre of this model is that WOUNDS AND CARGO SHARE SPACE. MCDM's
 * printed sheet is nothing but slots, with a wound checkbox on every backpack
 * slot, and filling all ten with wounds kills you (R p12). So `wounds` is a
 * ten-element array indexed by backpack slot, not a counter.
 */
export default class CrowData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      characteristics: new fields.SchemaField(
        Object.fromEntries(
          Object.keys(CROWS.characteristics).map((key) => [
            key,
            new fields.SchemaField({
              value: new fields.NumberField({
                required: true,
                nullable: false,
                integer: true,
                initial: 0,
                min: CROWS.characteristicRange.min,
                max: CROWS.characteristicRange.max
              })
            })
          ])
        )
      ),

      stamina: new fields.SchemaField({
        value: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 5, min: 0 }),
        max: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 5, min: 0 })
      }),

      speed: new fields.SchemaField({
        base: new fields.NumberField({
          required: true,
          nullable: false,
          integer: true,
          initial: CROWS.creation.startingSpeed,
          min: 0
        }),
        /** Traits, magic, and Miasma effects adjust this rather than `base`. */
        bonus: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 })
      }),

      /**
       * One entry per backpack slot. "" means unwounded; otherwise the wound
       * kind, because starvation wounds clear by eating rather than resting
       * (R p16) and backlash wounds clear only by their own fiction.
       */
      wounds: new fields.ArrayField(
        new fields.StringField({ required: true, blank: true, initial: "", choices: ["", ...Object.keys(CROWS.woundKinds)] }),
        { required: true, initial: () => Array(CROWS.containers.backpack.size).fill("") }
      ),

      /**
       * Expertise uses. `uses` is the pool the background and advancement have
       * granted; `spent` resets on a completed rest — except in the Miasma,
       * which withholds exactly this recovery (R p27).
       */
      expertises: new fields.SchemaField(
        Object.fromEntries(
          Object.keys(CROWS.expertises).map((key) => [
            key,
            new fields.SchemaField({
              uses: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
              spent: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 })
            })
          ])
        )
      ),

      xp: new fields.SchemaField({
        /** Lifetime total; advancement thresholds read this and it never drops. */
        total: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
        spent: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 })
      }),

      /**
       * The advancement bonuses this crow has actually TAKEN (C p6-7).
       *
       * TXP says how many bonuses are owed; this says which have been claimed
       * and what was chosen, so "3 bonuses" can finally mean "1 still to take"
       * rather than a number that never moves.
       *
       * Each entry records WHERE its expertise uses landed. That is what makes
       * a bonus undoable, and it is also what makes the background's own uses
       * derivable without storing them — anything on the sheet this ledger
       * does not account for came from the background.
       *
       * NOTE the namespace: `prepareDerivedData` merges derived counts onto
       * `this.advancement` rather than replacing it. Replacing it would drop
       * the stored ledger on every prepare.
       */
      advancement: new fields.SchemaField({
        bonuses: new fields.ArrayField(
          new fields.SchemaField({
            option: new fields.StringField({
              required: true,
              blank: false,
              initial: "expertise",
              choices: Object.keys(CROWS.expertiseBonusOptions)
            }),
            /** { expertiseKey: usesGranted } */
            uses: new fields.ObjectField({ required: true, initial: () => ({}) }),
            stamina: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 })
          }),
          { required: true, initial: [] }
        ),
        /** Which characteristic each claimed characteristic bonus raised. */
        characteristics: new fields.ArrayField(
          new fields.StringField({ required: true, blank: true, initial: "" }),
          { required: true, initial: [] }
        )
      }),

      coin: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),

      /** Cruelty accrued in the Miasma; each level is -1 to resist it (R p27). */
      cruelty: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),

      /** Rolled Miasma effects currently afflicting this crow. */
      miasmaEffects: new fields.ArrayField(
        new fields.SchemaField({
          roll: new fields.NumberField({ required: true, nullable: false, integer: true }),
          first: new fields.StringField({ required: false, blank: true, initial: "" }),
          second: new fields.StringField({ required: false, blank: true, initial: "" })
        }),
        { required: true, initial: [] }
      ),

      /** Prepare for Task rest activity: a named task and its standing bonus (R p15). */
      prepared: new fields.SchemaField({
        task: new fields.StringField({ required: false, blank: true, initial: "" }),
        bonus: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 })
      }),

      biography: new fields.SchemaField({
        background: new fields.StringField({ required: false, blank: true, initial: "" }),
        /** The one thing that makes them stand out (C p1). */
        feature: new fields.StringField({ required: false, blank: true, initial: "" }),
        village: new fields.StringField({ required: false, blank: true, initial: "" }),
        connection: new fields.StringField({ required: false, blank: true, initial: "" }),
        notes: new fields.HTMLField({ required: false, blank: true, initial: "" })
      })
    };
  }

  /* -------------------------------------------- */

  /** Normalise the wound array before anything derives from it. */
  prepareBaseData() {
    const size = CROWS.containers.backpack.size;
    // Defensive: a hand-edited or migrated actor may carry the wrong length,
    // and every downstream calculation indexes this array by slot number.
    if (this.wounds.length !== size) {
      const next = Array(size).fill("");
      for (let i = 0; i < Math.min(size, this.wounds.length); i++) next[i] = this.wounds[i] ?? "";
      this.wounds = next;
    }
  }

  /* -------------------------------------------- */

  prepareDerivedData() {
    const backpackSize = CROWS.containers.backpack.size;

    /* --- Slot occupancy -------------------------------------------------- */

    // Which backpack slots hold cargo. Built from items so it cannot drift from
    // what is actually carried.
    const occupied = new Set();
    for (const item of this.parent?.items ?? []) {
      const carried = item.system?.carried;
      if (carried?.container !== "backpack" || carried.index === null) continue;
      const span = Math.max(1, item.system.slots ?? 1);
      for (let i = 0; i < span; i++) occupied.add(carried.index + i);
    }
    this.occupiedBackpackSlots = occupied;

    /* --- Wounds ---------------------------------------------------------- */

    this.woundCount = this.wounds.filter((w) => w !== "").length;
    this.starvationWounds = this.wounds.filter((w) => w === "starvation").length;

    // All ten slots wounded is death (R p12).
    this.dead = this.woundCount >= backpackSize;

    /**
     * "For each slot occupied by a wound and an item, your speed is reduced by
     * 1" (R p12). Read strictly, only slots carrying BOTH cost speed — the
     * looser reading (every wound OR item costs 1) would floor a starting
     * crow's speed at 0 the moment they packed a full bag, which cannot be
     * intended. The setting exists because the sentence is genuinely ambiguous
     * and a table may rule otherwise.
     */
    const rule = game.settings?.get?.(CROWS.id, "woundSpeedRule") ?? "both";
    let penalty = 0;
    for (let i = 0; i < backpackSize; i++) {
      const wounded = this.wounds[i] !== "";
      const packed = occupied.has(i);
      if (rule === "either") penalty += wounded || packed ? 1 : 0;
      else penalty += wounded && packed ? 1 : 0;
    }
    this.speedPenalty = penalty;

    /* --- Speed ----------------------------------------------------------- */

    this.speed.value = Math.max(0, this.speed.base + this.speed.bonus - penalty);

    /* --- Armor Defense --------------------------------------------------- */

    // AD is a depleting pool spread across worn armor and a wielded shield. The
    // crow chooses which source absorbs a hit, so keep the sources listed and
    // report the total only for the token bar.
    const sources = (this.parent?.items ?? []).filter((i) => i.type === "armor" && i.system.active);
    this.armorSources = sources;
    this.armor = {
      value: sources.reduce((sum, i) => sum + i.system.ad.value, 0),
      max: sources.reduce((sum, i) => sum + i.system.ad.max, 0)
    };

    /* --- Expertises ------------------------------------------------------ */

    // Remaining uses drive the "apply expertise" buttons on roll chat cards.
    this.expertiseRemaining = {};
    for (const key of Object.keys(CROWS.expertises)) {
      const e = this.expertises[key];
      this.expertiseRemaining[key] = Math.max(0, e.uses - e.spent);
    }

    /* --- Advancement ----------------------------------------------------- */

    this.xp.available = Math.max(0, this.xp.total - this.xp.spent);
    // MERGE, never assign: `advancement` is a stored schema field holding the
    // ledger of claimed bonuses, and replacing the object would drop it.
    Object.assign(this.advancement, this.#deriveAdvancement());

    /* --- Carried light ---------------------------------------------------- */

    /**
     * The light this crow is actually casting.
     *
     * Only a source held in a HAND counts: a torch in the backpack lights
     * nothing, which is the point of hand slots being scarce. An exhausted
     * source (usage dice all spent) has burned out and is dark.
     *
     * Card notation is "X/Y" — X squares of bright light, then Y MORE squares
     * of dim (R p15). Foundry's `dim` radius INCLUDES the bright part, so the
     * two have to be summed rather than passed through, or every torch would
     * light half as far as it should.
     */
    const feetPerSquare = CROWS.combat.feetPerSquare;
    let best = null;
    for (const item of this.parent?.items ?? []) {
      if (item.system?.carried?.container !== "hand") continue;
      const light = item.system?.light;
      if (!light || (!light.bright && !light.dim)) continue;
      if (item.system.ud?.max > 0 && item.system.ud.value <= 0) continue; // burned out

      const reach = light.bright + light.dim;
      if (!best || reach > best.reach) {
        best = { item, reach, bright: light.bright, dim: light.dim };
      }
    }

    this.lightSource = best
      ? {
          name: best.item.name,
          brightSquares: best.bright,
          dimSquares: best.dim,
          // Foundry radii, in scene distance units.
          bright: best.bright * feetPerSquare,
          dim: (best.bright + best.dim) * feetPerSquare
        }
      : null;

    /* --- Magic slot overload --------------------------------------------- */

    // Two items in one magic slot means no rest and 1d6 wounds per DT (R p11).
    const magicCounts = {};
    for (const item of this.parent?.items ?? []) {
      const slot = item.system?.carried?.magicSlot;
      if (item.system?.carried?.container === "magic" && slot) {
        magicCounts[slot] = (magicCounts[slot] ?? 0) + 1;
      }
    }
    this.magicSlotOverload = Object.entries(magicCounts)
      .filter(([, n]) => n > 1)
      .map(([slot]) => slot);
  }

  /* -------------------------------------------- */

  /**
   * What TXP has unlocked, against what has actually been claimed (C p6-7).
   *
   * The counts this returns are EARNED and TAKEN separately, because they are
   * different questions and the sheet was answering only the first one — it
   * showed a bonus count that never moved no matter how much a crow trained,
   * under a tooltip promising "still to assign".
   */
  #deriveAdvancement() {
    const txp = this.xp.total;
    const { count: earned, maxUses } = earnedBonuses(txp);
    const charEarned = earnedCharacteristicBonuses(txp);

    const bonuses = this.advancement?.bonuses ?? [];
    const taken = bonuses.length;
    const charTaken = (this.advancement?.characteristics ?? []).length;
    const granted = grantedTotals(bonuses);

    return {
      earned,
      taken,
      available: Math.max(0, earned - taken),
      maxUses,
      charEarned,
      charTaken,
      charAvailable: Math.max(0, charEarned - charTaken),
      grantedUses: granted.usesTotal,
      grantedStamina: granted.stamina,
      grantedByExpertise: granted.uses,
      backgroundUses: backgroundUses(this.expertises, bonuses)
    };
  }

  /* -------------------------------------------- */

  /** The modifier a test adds for a named characteristic (or the better of two). */
  characteristicMod(which) {
    const c = this.characteristics;
    switch (which) {
      case "agility":
      case "mind":
      case "strength":
        return c[which].value;
      case "agilityOrStrength":
        return Math.max(c.agility.value, c.strength.value);
      case "agilityOrMind":
        return Math.max(c.agility.value, c.mind.value);
      case "mindOrStrength":
        return Math.max(c.mind.value, c.strength.value);
      default:
        return 0;
    }
  }
}
