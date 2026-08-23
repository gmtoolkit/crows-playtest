/**
 * Shared schema fragments.
 *
 * Crows models most physical things as "cards" — the printed inventory cards
 * carry slot cost, stack size, usage dice, price, and crafting requirements in
 * a fixed layout. Every carryable item type reuses that block rather than
 * redeclaring it, so a card field added here shows up on gear, weapons, armor
 * and spellbooks at once.
 */

const fields = foundry.data.fields;

/**
 * A number with a hard clamp, used for the many bounded values in this game
 * (characteristics -5..5, usage dice, slot indices).
 */
export function boundedNumber(min, max, initial = 0) {
  return new fields.NumberField({
    required: true,
    nullable: false,
    integer: true,
    initial,
    min,
    max
  });
}

/**
 * Where an item physically lives on a crow. Multi-slot items occupy `span`
 * consecutive slots starting at `index`; the rules require those slots be
 * adjacent and of the same container type (R p10).
 *
 * `index` is null when the item is not placed (e.g. sitting in a chest, or
 * owned by a creature that has no slot inventory).
 */
export function carriedField() {
  return new fields.SchemaField({
    container: new fields.StringField({
      required: true,
      initial: "backpack",
      choices: ["hand", "belt", "backpack", "magic", "none"]
    }),
    /** Numeric slot for hand/belt/backpack; a magic-slot key for `magic`. */
    index: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null, min: 0 }),
    magicSlot: new fields.StringField({
      required: false,
      nullable: true,
      initial: null,
      choices: [null, "head", "neck", "waist", "arms", "finger", "feet"]
    })
  });
}

/**
 * Usage dice (R p13). A pool of d6s; each die showing 1 or 2 is removed. The
 * pool being empty means different things per item, which is why `restore`
 * exists separately from `trigger`.
 */
export function usageDiceField() {
  return new fields.SchemaField({
    /** Current number of dice in the pool. */
    value: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
    /** Pool size when full. 0 means this item has no usage dice at all. */
    max: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
    /** When the pool is rolled: end of dungeon turn, on activation, or never. */
    trigger: new fields.StringField({ required: true, initial: "none", choices: ["none", "dt", "activate"] }),
    /** What refills it. */
    restore: new fields.StringField({ required: true, initial: "useless", choices: ["useless", "refuel", "rest"] }),
    /** For `refuel`: what must be consumed (e.g. "1 oil flask"). */
    refuelWith: new fields.StringField({ required: false, blank: true, initial: "" })
  });
}

/**
 * The crafting block printed at the bottom of a card:
 * "Blacksmithing 1 | 1 iron bar | 10" — expertise and uses required, the
 * materials consumed, and the crafting goal in points (R p36).
 */
export function craftingField() {
  return new fields.SchemaField({
    expertise: new fields.StringField({ required: false, blank: true, initial: "" }),
    uses: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
    materials: new fields.StringField({ required: false, blank: true, initial: "" }),
    /** Points needed to finish the item. Higher = longer to make. */
    goal: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
    /** Points accrued so far on an in-progress copy. */
    progress: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 })
  });
}

/**
 * The common block every inventory card carries. Composed into gear, weapon,
 * armor and spellbook schemas.
 */
export function cardFields() {
  return {
    description: new fields.HTMLField({ required: false, blank: true, initial: "" }),
    /** Inventory slots consumed. Must be contiguous within one container. */
    slots: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 1, min: 0 }),
    /** How many of this item share a single slot (5 potions, 2 oil flasks). */
    stack: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 1, min: 1 }),
    /** How many are actually here. Capped at `stack` per occupied slot. */
    quantity: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 1, min: 0 }),
    /** Price in gold coins. Unique items have no price and use `xpValue`. */
    price: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
    /** Unique items award a flat XP value instead of a gc price (C p6). */
    xpValue: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null, min: 0 }),
    magic: new fields.BooleanField({ required: true, initial: false }),
    /** Magic items are not identified until examined (R p37). */
    identified: new fields.BooleanField({ required: true, initial: true }),
    /** Magic item slot this must occupy to function, if any. */
    magicSlot: new fields.StringField({
      required: false,
      nullable: true,
      initial: null,
      choices: [null, "head", "neck", "waist", "arms", "finger", "feet"]
    }),
    carried: carriedField(),
    ud: usageDiceField(),
    crafting: craftingField(),
    /** Provenance so a takedown or a playtest revision can be traced. */
    source: new fields.StringField({ required: false, blank: true, initial: "" })
  };
}

/**
 * An attack profile. Shared by weapons, attack-spells, and creature attacks so
 * one roll pipeline serves all three.
 *
 * Tier damage is stored as a formula string that may reference `@mod` (the
 * characteristic actually used) — the cards print "3 + S" and "2 + A or S",
 * so `characteristic: "agilityOrStrength"` plus `tier2: "2 + @mod"` reproduces
 * the card exactly while letting the roller pick the better characteristic.
 */
export function attackFields() {
  return {
    /** Which characteristic the test adds. "agilityOrStrength" = attacker chooses. */
    characteristic: new fields.StringField({
      required: true,
      initial: "strength",
      choices: ["agility", "mind", "strength", "agilityOrStrength", "agilityOrMind", "mindOrStrength", "none"]
    }),
    /** Flat bonus printed in parentheses on creature attacks, e.g. "Claws (+2)". */
    bonus: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
    range: new fields.SchemaField({
      type: new fields.StringField({ required: true, initial: "melee", choices: ["melee", "ranged", "both"] }),
      /** Melee reach in squares, or ranged normal range in squares. */
      value: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 1, min: 0 }),
      /** For thrown weapons that print "Melee 1/Ranged 5". */
      thrownValue: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null, min: 0 })
    }),
    /** How many creatures one attack may hit; cards print "(2 tar)". */
    targets: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 1, min: 1 }),
    /** Tier 1 is a miss by default; some profiles print an explicit effect. */
    tier1: new fields.StringField({ required: false, blank: true, initial: "" }),
    tier2: new fields.StringField({ required: false, blank: true, initial: "" }),
    tier3: new fields.StringField({ required: false, blank: true, initial: "" }),
    /** Damage that bypasses Armor Defense entirely (R p12). */
    piercing: new fields.BooleanField({ required: true, initial: false }),
    /** Free-text rider printed under the profile (e.g. "*Tendril Snare"). */
    note: new fields.HTMLField({ required: false, blank: true, initial: "" })
  };
}
