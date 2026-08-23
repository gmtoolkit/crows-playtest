import { cardFields } from "./fields.mjs";

const fields = foundry.data.fields;

/**
 * Armor and shields. Armor Defense is a depleting pool, not a to-hit number:
 * damage is subtracted from AD first, and when AD hits 0 the item stops
 * stopping damage until repaired (R p12).
 *
 * A crow may nominate one suit in their backpack as worn, and worn armor does
 * not need a hand slot — but a shield does.
 */
export default class ArmorData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...cardFields(),

      /**
       * MEDIUM WAS MISSING and the deck proves it should not have been: the
       * cards print Light Armor (AD 5), Medium Armor (AD 10) and Heavy Armor
       * (AD 15). Without the choice the extractor could not emit a category for
       * the medium suit at all, and a StringField with `choices` silently falls
       * back to its initial — so medium armour would have imported as light.
       */
      category: new fields.StringField({
        required: true,
        initial: "light",
        choices: ["light", "medium", "heavy", "shield"]
      }),

      /** Armor Defense: `value` depletes as damage lands, `max` is restored by repair. */
      ad: new fields.SchemaField({
        value: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
        max: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 })
      }),

      /**
       * Exactly one suit may be worn at a time. Shields are wielded from a hand
       * slot instead, so this stays false for them.
       */
      worn: new fields.BooleanField({ required: true, initial: false }),

      enchantments: new fields.ArrayField(
        new fields.SchemaField({
          name: new fields.StringField({ required: true, blank: false }),
          description: new fields.HTMLField({ required: false, blank: true, initial: "" })
        }),
        { required: true, initial: [] }
      ),

      /** Speed penalty printed on heavier suits, if any. */
      speedPenalty: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, max: 0 })
    };
  }

  prepareDerivedData() {
    this.isShield = this.category === "shield";
    /** A depleted suit still occupies slots but no longer absorbs damage. */
    this.depleted = this.ad.value <= 0;
    /**
     * Only a worn suit or a wielded shield contributes. `worn` is set by the
     * sheet; a shield contributes when it is in a hand slot.
     */
    this.active = this.isShield ? this.carried.container === "hand" : this.worn;
  }
}
