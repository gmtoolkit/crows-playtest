import { attackFields } from "./fields.mjs";

const fields = foundry.data.fields;

/**
 * A creature's attack line, e.g.
 *   Claws (+2)   Melee 1   12-16: "2 dam"   17+: "3 dam"
 *   Punches (+4) Melee 1 (2 tar)  12-16: "4 dam"  17+: "8 dam*"
 *
 * Creature attacks print a flat bonus rather than adding a characteristic, so
 * `characteristic` is overridden to default "none" and `bonus` carries the
 * printed number. The asterisk convention on the stat blocks points at a named
 * rider stored as a separate `feature` item; `noteRef` links the two.
 */
export default class AttackData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const schema = attackFields();

    // Creature attacks add a flat printed bonus, not a characteristic.
    schema.characteristic = new fields.StringField({
      required: true,
      initial: "none",
      choices: ["agility", "mind", "strength", "agilityOrStrength", "agilityOrMind", "mindOrStrength", "none"]
    });

    return {
      ...schema,

      description: new fields.HTMLField({ required: false, blank: true, initial: "" }),

      /**
       * Name of the feature this attack's asterisk refers to, so the chat card
       * can surface the rider text alongside the damage.
       */
      noteRef: new fields.StringField({ required: false, blank: true, initial: "" }),

      /** Which tiers carry the asterisk, so the rider only fires when it should. */
      riderTiers: new fields.ArrayField(new fields.NumberField({ integer: true, min: 1, max: 3 }), {
        required: true,
        initial: []
      }),

      source: new fields.StringField({ required: false, blank: true, initial: "" })
    };
  }
}
