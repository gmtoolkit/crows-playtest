import { cardFields, attackFields } from "./fields.mjs";

const fields = foundry.data.fields;

/**
 * A weapon card. Carries both the inventory block and an attack profile, so
 * the same roll pipeline serves weapons, spell attacks, and creature attacks.
 *
 * Example card (Sword): Melee 1, Attack 2d10 + S, 12-16 "3 + S", 17+ "6 + S",
 * properties Slashing / Disengage / Parry 4, crafting "Blacksmithing 1 |
 * 1 iron bar | 10", price 12 gc.
 */
export default class WeaponData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...cardFields(),
      ...attackFields(),

      /** Determines which weapon expertise may be applied to attacks (R p9). */
      group: new fields.StringField({
        required: true,
        initial: "slashing",
        choices: ["bashing", "bow", "chopping", "slashing", "stabbing", "unarmed"]
      }),

      /**
       * Card properties. Some carry a value ("Parry 4"), so each is a pair
       * rather than a bare tag.
       */
      properties: new fields.ArrayField(
        new fields.SchemaField({
          key: new fields.StringField({ required: true, blank: false }),
          value: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null })
        }),
        { required: true, initial: [] }
      ),

      /** Ammunition-consuming weapons name what they need. */
      ammunition: new fields.StringField({ required: false, blank: true, initial: "" }),

      /** Enchantments applied to a magic weapon, printed as named riders. */
      enchantments: new fields.ArrayField(
        new fields.SchemaField({
          name: new fields.StringField({ required: true, blank: false }),
          description: new fields.HTMLField({ required: false, blank: true, initial: "" })
        }),
        { required: true, initial: [] }
      ),

      /** Flat damage bonus from honing at a 4th-level blacksmith (C p50). */
      honed: new fields.BooleanField({ required: true, initial: false })
    };
  }

  /** Convenience lookups used by sheets and the roll pipeline. */
  prepareDerivedData() {
    this.propertyMap = Object.fromEntries(this.properties.map((p) => [p.key, p.value ?? true]));
    this.isThrown = this.range.type === "both" || "thrown" in this.propertyMap;
    /** Reach-extending weapons only extend reach for their own attacks (R p18). */
    this.reach = this.range.type === "ranged" ? 0 : this.range.value;
  }
}
