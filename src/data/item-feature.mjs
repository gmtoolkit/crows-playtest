const fields = foundry.data.fields;

/**
 * A named special ability on a creature — "Malleable", "Drop Attack",
 * "Extra Action", "Vanish (1/Rest)". Also used for NPC/pet quirks.
 *
 * These are descriptive by design: Crows monster abilities are short prose the
 * Ref adjudicates, not a rules engine. What we automate is surfacing them at
 * the right moment (on the attack that references them, or on the sheet).
 */
export default class FeatureData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField({ required: false, blank: true, initial: "" }),

      /**
       * Limited-use abilities print their budget, e.g. "Vanish (1/Rest)".
       * `max: 0` means unlimited.
       */
      uses: new fields.SchemaField({
        value: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
        max: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
        per: new fields.StringField({
          required: true,
          initial: "rest",
          choices: ["rest", "dt", "round", "encounter", "day"]
        })
      }),

      /**
       * Some features change how a creature acts rather than what it can do —
       * "Extra Action" grants another action each turn. Flagged so the sheet
       * can surface it near the turn economy instead of in the prose list.
       */
      affectsTurnEconomy: new fields.BooleanField({ required: true, initial: false }),

      source: new fields.StringField({ required: false, blank: true, initial: "" })
    };
  }
}
