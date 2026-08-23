import { cardFields } from "./fields.mjs";

const fields = foundry.data.fields;

/**
 * A generic inventory card: torches, rope, tools, potions, pets, corpses —
 * anything that occupies slots and is not a weapon, armor, or spellbook.
 */
export default class GearData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...cardFields(),

      /**
       * Light shed, as squares of bright / dim (R p15). A torch is 5/5.
       * Zero max means this item is not a light source.
       */
      light: new fields.SchemaField({
        bright: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
        dim: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 })
      }),

      /**
       * Using the item costs this much of a turn. Cards print things like
       * "Maneuver: Pouring the vial onto a surface destroys..." and
       * "Action: You can make a ranged 5 attack with it".
       */
      activation: new fields.SchemaField({
        type: new fields.StringField({
          required: true,
          initial: "none",
          choices: ["none", "free", "maneuver", "action", "reaction", "restActivity"]
        }),
        description: new fields.HTMLField({ required: false, blank: true, initial: "" })
      }),

      /** Crafting tools grant their bonus to the matching expertise's rolls. */
      tool: new fields.SchemaField({
        /** Which craft expertise this is a toolkit for, if any. */
        expertise: new fields.StringField({ required: false, blank: true, initial: "" }),
        quality: new fields.StringField({
          required: true,
          initial: "standard",
          choices: ["standard", "fine", "masterwork"]
        })
      }),

      /** Raw material for crafting (iron bars, monster parts, hickory logs). */
      material: new fields.BooleanField({ required: true, initial: false }),

      /** A pet occupies no slots but follows the Command maneuver rules (R p22). */
      pet: new fields.SchemaField({
        isPet: new fields.BooleanField({ required: true, initial: false }),
        size: new fields.StringField({
          required: false,
          blank: true,
          initial: "",
          choices: ["", "tiny", "small", "medium", "large", "huge", "holyShit"]
        }),
        speed: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
        /** Link to a creature actor so the pet can be dropped on the canvas. */
        actorUuid: new fields.StringField({ required: false, blank: true, initial: "" })
      }),

      /**
       * A corpse costs slots by size and is carried like cargo (R p11).
       * Tracked here so the Harvest rest activity can find it.
       */
      corpse: new fields.SchemaField({
        isCorpse: new fields.BooleanField({ required: true, initial: false }),
        size: new fields.StringField({
          required: false,
          blank: true,
          initial: "",
          choices: ["", "tiny", "small", "medium", "large", "huge", "holyShit"]
        })
      })
    };
  }

  /**
   * A corpse's slot cost is derived from its size rather than authored, so a
   * Medium body always costs 4 slots no matter who created the card.
   */
  prepareBaseData() {
    if (this.corpse?.isCorpse && this.corpse.size) {
      const size = CONFIG.CROWS.sizes[this.corpse.size];
      if (size) {
        this.slots = size.corpseSlots;
        this.stack = size.corpseStack;
      }
    }
    // Pets are led, not packed: they cost no inventory slots.
    if (this.pet?.isPet) this.slots = 0;
  }
}
