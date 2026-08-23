const fields = foundry.data.fields;

/**
 * One of the 36 backgrounds (C p1-6). A background is the entire chargen
 * payload: it sets a characteristic to 2, fixes starting Stamina, grants a
 * starting trait, seeds expertise uses, and hands over a kit.
 *
 * The builder consumes this document; nothing here is live data on a crow.
 */
export default class BackgroundData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField({ required: false, blank: true, initial: "" }),

      /**
       * Position on the 2d6 Backgrounds table (C p1), as [firstDie, secondDie].
       * Lets the builder roll on the real table rather than a flat list.
       */
      roll: new fields.SchemaField({
        first: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 1, min: 1, max: 6 }),
        second: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 1, min: 1, max: 6 })
      }),

      /**
       * Which characteristic the background raises to 2. Several backgrounds
       * offer a choice ("Mind or Strength"), and Beggar/Cook allow any — hence
       * a list rather than a single value. One entry = no choice to make.
       */
      characteristicAt2: new fields.ArrayField(
        new fields.StringField({ choices: ["agility", "mind", "strength"] }),
        { required: true, initial: ["mind"] }
      ),

      stamina: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 5, min: 1 }),

      /** Name of the starting trait granted, e.g. "Enchantment: Material Transfer". */
      trait: new fields.StringField({ required: false, blank: true, initial: "" }),

      /** Expertise uses seeded at creation. Most are 1; some backgrounds give 2. */
      expertises: new fields.ArrayField(
        new fields.SchemaField({
          key: new fields.StringField({ required: true, blank: false }),
          uses: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 1, min: 1 })
        }),
        { required: true, initial: [] }
      ),

      /**
       * Starting kit by item name and count. Resolved against the gear/weapon/
       * armor/spellbook packs at build time so the builder can place real cards.
       */
      equipment: new fields.ArrayField(
        new fields.SchemaField({
          name: new fields.StringField({ required: true, blank: false }),
          quantity: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 1, min: 1 })
        }),
        { required: true, initial: [] }
      ),

      /** Spellbook names granted; kept separate because they resolve to a different pack. */
      spellbooks: new fields.ArrayField(new fields.StringField({ blank: false }), {
        required: true,
        initial: []
      }),

      /** Backgrounds like Merchant and Noble add flat coin on top of the 3d6. */
      bonusGold: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),

      source: new fields.StringField({ required: false, blank: true, initial: "" })
    };
  }
}
