const fields = foundry.data.fields;

/**
 * A trait from one of the 23 trait trees (C p7-30).
 *
 * Purchase rules: you may buy a starting trait (top of a tree, 500 XP), or any
 * trait connected by a line to one you already own in the same tree. Each trait
 * is bought at most once. `prerequisites` encodes those connecting lines as the
 * set of traits any ONE of which unlocks this node.
 */
export default class TraitData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField({ required: false, blank: true, initial: "" }),

      tree: new fields.StringField({ required: true, blank: false, initial: "alchemy" }),

      cost: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 500, min: 0 }),

      /** Starting traits sit at the top of a tree and need no prerequisite. */
      starting: new fields.BooleanField({ required: true, initial: false }),

      /**
       * Names of traits in the same tree that unlock this one. Any single match
       * suffices — the trees branch, they do not require full rows.
       */
      prerequisites: new fields.ArrayField(new fields.StringField({ blank: false }), {
        required: true,
        initial: []
      }),

      /**
       * Row in the printed tree (0 = starting, then 1000/1500/2000 XP rows).
       * Used only for laying the tree out on the sheet.
       */
      row: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
      column: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),

      /**
       * Rest activities this trait unlocks, beyond the common list (R p15).
       */
      grantsRestActivity: new fields.StringField({ required: false, blank: true, initial: "" }),

      source: new fields.StringField({ required: false, blank: true, initial: "" })
    };
  }
}
