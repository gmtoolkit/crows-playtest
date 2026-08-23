import { cardFields, attackFields } from "./fields.mjs";
import { displayDamage, damageNotation } from "../dice/tiers.mjs";

const fields = foundry.data.fields;

/**
 * A spellbook. In Crows the spell lives in the book, not in the caster: anyone
 * holding the book can attempt it, casting is always a Mind test, and the
 * book's usage dice are rolled on every cast (R p30-31).
 *
 * A tier-1 casting risks a backlash — automatically on a doom, or on a 1 from
 * the 1d6 chaos roll otherwise.
 */
export default class SpellbookData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...cardFields(),
      ...attackFields(),

      /** 0-5. Higher rank shifts the backlash table upward when one fires. */
      rank: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0, max: 5 }),

      discipline: new fields.StringField({
        required: true,
        initial: "elemental",
        choices: ["alteration", "benefaction", "conjuration", "elemental", "illusion", "necromancy"]
      }),

      castingTime: new fields.StringField({
        required: true,
        initial: "action",
        choices: ["action", "maneuver", "reaction", "outOfCombat"]
      }),

      /** Trigger text for reaction spells. */
      trigger: new fields.StringField({ required: false, blank: true, initial: "" }),

      /** Free text mirroring the card's Target line ("1 ally", "All enemies"). */
      target: new fields.StringField({ required: false, blank: true, initial: "" }),

      area: new fields.SchemaField({
        type: new fields.StringField({ required: true, initial: "none", choices: ["none", "aura", "cube", "line"] }),
        /** Aura radius, cube side, or line length, in squares. */
        size: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
        /** Line width/height; unused for other shapes. */
        width: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null, min: 0 })
      }),

      duration: new fields.SchemaField({
        type: new fields.StringField({
          required: true,
          initial: "instant",
          choices: ["instant", "dt", "ud", "permanent"]
        }),
        /**
         * For `ud` durations: how many dice track the EFFECT. This is separate
         * from the book's own usage dice (R p31) and is a genuine trap — the
         * two pools deplete independently.
         */
        ud: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 })
      }),

      /** Whether the casting is also an attack, in which case attackFields apply. */
      isAttack: new fields.BooleanField({ required: true, initial: false }),

      /** Non-attack spells describe their outcome per tier instead of damage. */
      effects: new fields.SchemaField({
        tier1: new fields.HTMLField({ required: false, blank: true, initial: "" }),
        tier2: new fields.HTMLField({ required: false, blank: true, initial: "" }),
        tier3: new fields.HTMLField({ required: false, blank: true, initial: "" })
      })
    };
  }

  prepareDerivedData() {
    /** Castings are always Mind tests regardless of what the attack block says. */
    this.castCharacteristic = "mind";
    /** The spellcasting expertise that may be applied to this casting (R p9). */
    this.expertise = this.discipline;
    /** Empty books cannot be cast from until their dice are restored. */
    this.exhausted = this.ud.max > 0 && this.ud.value <= 0;

    // Castings are Mind tests, so card damage resolves against Mind.
    const actor = this.parent?.actor ?? null;
    this.displayTier2 = displayDamage(this.tier2, actor, "mind");
    this.displayTier3 = displayDamage(this.tier3, actor, "mind");

    // Tooltip form: the notation the printed card uses ("4 + M").
    this.notationTier2 = damageNotation(this.tier2, "mind");
    this.notationTier3 = damageNotation(this.tier3, "mind");
  }
}
