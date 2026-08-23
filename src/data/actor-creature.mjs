import { CROWS } from "../config.mjs";

const fields = foundry.data.fields;

/**
 * Everything the Ref controls: monsters, humans, and animals.
 *
 * These share one model deliberately. The Ref Book prints them in one format
 * (Size / Power / Type, Stamina, Speed, three characteristics, an attack table,
 * then named features), and the only real divergence is that humans and animals
 * take wounds when their Stamina hits 0 while monsters simply die (R p12).
 */
export default class CreatureData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      /** monster | human | animal — decides the wound rule and the art tab. */
      category: new fields.StringField({
        required: true,
        initial: "monster",
        choices: Object.keys(CROWS.creatureCategories)
      }),

      /** Monster type drives the shared likes/hates and encounter table (F p30). */
      monsterType: new fields.StringField({
        required: false,
        blank: true,
        initial: "",
        choices: ["", ...Object.keys(CROWS.monsterTypes)]
      }),

      size: new fields.StringField({
        required: true,
        initial: "medium",
        choices: Object.keys(CROWS.sizes)
      }),

      /**
       * Power is Crows' threat rating, not a level. It gates monster morale
       * (power <= 9 may flee an overwhelming hate) and is the Ref's only
       * encounter-budget signal.
       */
      power: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),

      stamina: new fields.SchemaField({
        value: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 10, min: 0 }),
        max: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 10, min: 0 })
      }),

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

      /**
       * Stat blocks print speed as "6, climb 6 (U)" or "5". The (U) marks a
       * climber that can hang upside down without a test (R p21).
       */
      speed: new fields.SchemaField({
        walk: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 5, min: 0 }),
        climb: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
        fly: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
        swim: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
        burrow: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
        upsideDown: new fields.BooleanField({ required: true, initial: false })
      }),

      /** Most creatures get 1 reaction a round; the Ring Collector prints 4. */
      reactions: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 1, min: 0 }),

      /** Armor Defense, for the few Ref-side creatures that carry it. */
      ad: new fields.SchemaField({
        value: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
        max: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 })
      }),

      /**
       * Humans and animals take wounds like a crow does. The rules do not give
       * them a slot inventory, so this is a plain counter with a Ref-set cap.
       */
      wounds: new fields.SchemaField({
        value: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
        max: new fields.NumberField({
          required: true,
          nullable: false,
          integer: true,
          initial: CROWS.containers.backpack.size,
          min: 1
        })
      }),

      /** "blood spider, mouth eyes" — what NPCs call this thing (F p30). */
      colloquialNames: new fields.StringField({ required: false, blank: true, initial: "" }),

      /**
       * Likes and hates are per monster TYPE, not per monster, so these are
       * normally left blank and inherited. A unique may override them.
       */
      likes: new fields.StringField({ required: false, blank: true, initial: "" }),
      hates: new fields.StringField({ required: false, blank: true, initial: "" }),

      description: new fields.HTMLField({ required: false, blank: true, initial: "" }),
      /** Ref-only lore, hidden from players on the sheet. */
      secrets: new fields.HTMLField({ required: false, blank: true, initial: "" }),

      source: new fields.StringField({ required: false, blank: true, initial: "" })
    };
  }

  /* -------------------------------------------- */

  prepareDerivedData() {
    const size = CROWS.sizes[this.size] ?? CROWS.sizes.medium;

    /** Space and reach are read off size, never authored (R p18). */
    this.space = size.squares;
    this.reach = size.reach;
    this.corpseSlots = size.corpseSlots;
    this.harvestDice = CROWS.harvestDice[this.size] ?? "1d6";

    /** Monsters ignore dim light and darkness penalties entirely (F p30). */
    this.ignoresDarkness = this.category === "monster" && CROWS.monstersIgnoreDarkness;

    /** Only humans and animals take wounds; a monster at 0 Stamina is dead. */
    this.usesWounds = this.category !== "monster";
    this.dead = this.usesWounds ? this.wounds.value >= this.wounds.max : this.stamina.value <= 0;

    /** Weak monsters flee an overwhelming hate rather than engage it (F p30). */
    this.isWeak = this.power <= CROWS.weakMonsterPowerMax;

    /** Inherit the type's shared likes/hates unless this creature overrides. */
    const typeInfo = CROWS.monsterTypes[this.monsterType];
    this.effectiveLikes = this.likes || typeInfo?.likes || "";
    this.effectiveHates = this.hates || typeInfo?.hates || "";

    /** Mirror the token bar attribute name used by crows. */
    this.armor = { value: this.ad.value, max: this.ad.max };
  }

  /* -------------------------------------------- */

  /** Same contract as CrowData so one roll pipeline serves both. */
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
