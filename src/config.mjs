/**
 * CROWS — system configuration.
 *
 * Single source of truth for every enum, table, and threshold the rules define.
 * Anything a rules-lawyer would look up in the books lives here, not inline at
 * a call site, so a playtest revision is a diff against one file.
 *
 * Page references are to the Playtest 2 books (Aug-Sept 2026):
 *   R = The Rules Book, C = Characters Book, F = The Ref Book, D = Dungeons Book
 */

export const CROWS = {};

CROWS.id = "crows";

/* -------------------------------------------- */
/*  Core resolution (R p6-7)                    */
/* -------------------------------------------- */

/**
 * Every test is 2d10 + characteristic, read as a tier.
 *   tier 1: <= 11   failure, possible setback
 *   tier 2: 12-16   partial success, or success at a cost
 *   tier 3: >= 17   clean success
 *
 * Crit and doom are read off the RAW dice only ("the dice without any
 * modifiers"), which is why they beat edges and banes: a crit is tier 3
 * "regardless of banes or other penalties", a doom is tier 1 "regardless of
 * edges, expertises, and other bonuses".
 */
CROWS.roll = {
  formula: "2d10",
  tier2Min: 12,
  tier3Min: 17,
  /** Raw 2d10 sum at or above this is a critical success. */
  critMin: 19,
  /** Raw 2d10 sum at or below this is a doom. */
  doomMax: 3,
  /** A single edge/bane is a flat modifier; two or more shift a tier instead. */
  edgeBonus: 2,
  banePenalty: -2
};

CROWS.tiers = {
  1: "CROWS.Tier1",
  2: "CROWS.Tier2",
  3: "CROWS.Tier3"
};

/* -------------------------------------------- */
/*  Characteristics (R p5)                      */
/* -------------------------------------------- */

CROWS.characteristics = {
  agility: { label: "CROWS.Agility", abbr: "CROWS.AgilityAbbr" },
  mind: { label: "CROWS.Mind", abbr: "CROWS.MindAbbr" },
  strength: { label: "CROWS.Strength", abbr: "CROWS.StrengthAbbr" }
};

/** Hard rules bounds. PCs start -1..2; 4 is the no-magic ceiling (R p5). */
CROWS.characteristicRange = { min: -5, max: 5, pcStartMin: -1, pcStartMax: 2, pcCap: 4 };

/* -------------------------------------------- */
/*  Expertises (R p8-9)                         */
/* -------------------------------------------- */

/**
 * Expertise categories matter mechanically: only spellcasting expertises apply
 * to castings, and only weapon expertises apply to weapon attacks (R p9).
 */
CROWS.expertiseCategories = {
  general: "CROWS.ExpertiseGeneral",
  spellcasting: "CROWS.ExpertiseSpellcasting",
  weapon: "CROWS.ExpertiseWeapon"
};

CROWS.expertises = {
  // General (R p8)
  alchemy: { label: "CROWS.ExpAlchemy", category: "general", craftTool: "alchemist" },
  athletics: { label: "CROWS.ExpAthletics", category: "general" },
  blacksmithing: { label: "CROWS.ExpBlacksmithing", category: "general", craftTool: "blacksmith" },
  enchanting: { label: "CROWS.ExpEnchanting", category: "general", craftTool: "enchanter" },
  endurance: { label: "CROWS.ExpEndurance", category: "general" },
  gymnastics: { label: "CROWS.ExpGymnastics", category: "general" },
  handlePet: { label: "CROWS.ExpHandlePet", category: "general" },
  historicalLore: { label: "CROWS.ExpHistoricalLore", category: "general" },
  lift: { label: "CROWS.ExpLift", category: "general" },
  magicLore: { label: "CROWS.ExpMagicLore", category: "general" },
  monsterLore: { label: "CROWS.ExpMonsterLore", category: "general" },
  natureLore: { label: "CROWS.ExpNatureLore", category: "general" },
  navigate: { label: "CROWS.ExpNavigate", category: "general" },
  pickLock: { label: "CROWS.ExpPickLock", category: "general" },
  religiousLore: { label: "CROWS.ExpReligiousLore", category: "general" },
  search: { label: "CROWS.ExpSearch", category: "general" },
  stealth: { label: "CROWS.ExpStealth", category: "general" },
  thievery: { label: "CROWS.ExpThievery", category: "general" },

  // Spellcasting (R p9) — key matches CROWS.disciplines
  alteration: { label: "CROWS.ExpAlteration", category: "spellcasting", discipline: "alteration" },
  benefaction: { label: "CROWS.ExpBenefaction", category: "spellcasting", discipline: "benefaction" },
  conjuration: { label: "CROWS.ExpConjuration", category: "spellcasting", discipline: "conjuration" },
  elemental: { label: "CROWS.ExpElemental", category: "spellcasting", discipline: "elemental" },
  illusion: { label: "CROWS.ExpIllusion", category: "spellcasting", discipline: "illusion" },
  necromancy: { label: "CROWS.ExpNecromancy", category: "spellcasting", discipline: "necromancy" },

  // Weapon (R p9) — key matches a weapon's `group`
  bashing: { label: "CROWS.ExpBashing", category: "weapon", weaponGroup: "bashing" },
  bow: { label: "CROWS.ExpBow", category: "weapon", weaponGroup: "bow" },
  chopping: { label: "CROWS.ExpChopping", category: "weapon", weaponGroup: "chopping" },
  slashing: { label: "CROWS.ExpSlashing", category: "weapon", weaponGroup: "slashing" },
  stabbing: { label: "CROWS.ExpStabbing", category: "weapon", weaponGroup: "stabbing" },
  unarmed: { label: "CROWS.ExpUnarmed", category: "weapon", weaponGroup: "unarmed" }
};

/* -------------------------------------------- */
/*  Magic (R p30-31)                            */
/* -------------------------------------------- */

CROWS.disciplines = {
  alteration: "CROWS.DisciplineAlteration",
  benefaction: "CROWS.DisciplineBenefaction",
  conjuration: "CROWS.DisciplineConjuration",
  elemental: "CROWS.DisciplineElemental",
  illusion: "CROWS.DisciplineIllusion",
  necromancy: "CROWS.DisciplineNecromancy"
};

CROWS.castingTimes = {
  action: "CROWS.CastAction",
  maneuver: "CROWS.CastManeuver",
  reaction: "CROWS.CastReaction",
  outOfCombat: "CROWS.CastOutOfCombat"
};

CROWS.spellDurations = {
  instant: "CROWS.DurationInstant",
  dt: "CROWS.DurationDT",
  ud: "CROWS.DurationUD",
  permanent: "CROWS.DurationPermanent"
};

CROWS.areaTypes = {
  none: "CROWS.AreaNone",
  aura: "CROWS.AreaAura",
  cube: "CROWS.AreaCube",
  line: "CROWS.AreaLine"
};

CROWS.spellRanks = [0, 1, 2, 3, 4, 5];

/** A tier-1 casting that is not a doom triggers a backlash on a d6 of 1 (R p31). */
CROWS.chaosRoll = { formula: "1d6", backlashOn: 1 };

/* -------------------------------------------- */
/*  Sizes (R p10, p18)                          */
/* -------------------------------------------- */

/**
 * `squares` is the side length of the space (Large = 2x2), `reach` is the
 * natural reach in squares, and `corpseSlots` is what the body costs to carry
 * (R p11). `corpseStack` is how many such corpses share one slot.
 */
CROWS.sizes = {
  tiny: { label: "CROWS.SizeTiny", squares: 1, reach: 1, corpseSlots: 1, corpseStack: 3, order: 0 },
  small: { label: "CROWS.SizeSmall", squares: 1, reach: 1, corpseSlots: 2, corpseStack: 1, order: 1 },
  medium: { label: "CROWS.SizeMedium", squares: 1, reach: 1, corpseSlots: 4, corpseStack: 1, order: 2 },
  large: { label: "CROWS.SizeLarge", squares: 2, reach: 2, corpseSlots: 8, corpseStack: 1, order: 3 },
  huge: { label: "CROWS.SizeHuge", squares: 3, reach: 2, corpseSlots: 16, corpseStack: 1, order: 4 },
  holyShit: { label: "CROWS.SizeHolyShit", squares: 4, reach: 3, corpseSlots: 32, corpseStack: 1, order: 5 }
};

/** Monster harvest yield by size, in parts (R p15 Harvest rest activity). */
CROWS.harvestDice = { tiny: "1d6", small: "1d6", medium: "1d6", large: "2d6", huge: "3d6", holyShit: "4d6" };

/* -------------------------------------------- */
/*  Inventory (R p10-11)                        */
/* -------------------------------------------- */

/**
 * The physical inventory sheet MCDM ships is the character sheet: 2 hand slots,
 * 4 belt slots, 10 numbered backpack slots, and a wound checkbox on every
 * backpack slot. Multi-slot items must occupy adjacent slots of the same
 * container.
 */
CROWS.containers = {
  hand: { label: "CROWS.ContainerHand", size: 2, stackable: false, equipped: true },
  belt: { label: "CROWS.ContainerBelt", size: 4, stackable: true },
  backpack: { label: "CROWS.ContainerBackpack", size: 10, stackable: true, woundable: true },
  magic: { label: "CROWS.ContainerMagic", size: 6, stackable: false, keyed: true }
};

/** Worn magic item slots (R p11). Two items in one slot = 1d6 wounds per DT. */
CROWS.magicSlots = {
  head: "CROWS.MagicSlotHead",
  neck: "CROWS.MagicSlotNeck",
  waist: "CROWS.MagicSlotWaist",
  arms: "CROWS.MagicSlotArms",
  finger: "CROWS.MagicSlotFinger",
  feet: "CROWS.MagicSlotFeet"
};

/** Damage taken while overloading a magic slot, per dungeon turn (R p11). */
CROWS.magicSlotOverloadWounds = "1d6";

CROWS.woundKinds = {
  normal: "CROWS.WoundNormal",
  /** Cleared entirely by eating a ration, not by resting (R p16). */
  starvation: "CROWS.WoundStarvation",
  /** Backlash tentacles etc: removed by a specific fictional action, not rest. */
  special: "CROWS.WoundSpecial"
};

/* -------------------------------------------- */
/*  Usage dice (R p13)                          */
/* -------------------------------------------- */

/** All UD are d6; a die showing 1 or 2 is removed from the pool. */
CROWS.usageDice = {
  formula: "1d6",
  /** A die is spent (removed) on these faces. */
  spendOn: [1, 2]
};

/** When the pool is rolled. */
CROWS.udTriggers = {
  none: "CROWS.UDTriggerNone",
  /** Rolled at the end of every dungeon turn (torches, ongoing spells). */
  dt: "CROWS.UDTriggerDT",
  /** Rolled when the item is used (spellbooks, quivers). */
  activate: "CROWS.UDTriggerActivate"
};

/** What restores the pool. */
CROWS.udRestore = {
  /** Never: the item is permanently spent. */
  useless: "CROWS.UDRestoreUseless",
  /** Consuming a named item restores it (a pint of oil refills a lantern). */
  refuel: "CROWS.UDRestoreRefuel",
  /** Finishing a rest restores it (spellbooks). */
  rest: "CROWS.UDRestoreRest"
};

/* -------------------------------------------- */
/*  Dungeon turns and encounters (R p13-14)     */
/* -------------------------------------------- */

CROWS.dungeonTurn = {
  /** Real-world minutes per dungeon turn. The rules offer 20/30/60. */
  defaultMinutes: 30,
  relaxedMinutes: 60,
  intenseMinutes: 20,
  /** Outside a dungeon, this many in-fiction hours equals one DT. */
  hoursPerTurnOutsideDungeon: 2,
  /**
   * Minutes remaining at which to warn the table. The pressure only works if
   * the crows can hear it coming and choose how to spend the last of it.
   */
  warnMinutes: [10, 5, 1],
  /** Alternative to the timer: each DT lasts this many rooms. */
  roomsFormula: "1d6"
};

/**
 * Encounter check: roll 1d10, an encounter occurs on a result >= EN.
 * A HIGHER EN is therefore SAFER. This reads backwards at first glance and is
 * the single easiest thing to invert when implementing travel modifiers.
 */
CROWS.encounter = {
  formula: "1d10",
  dungeonDefaultEN: 9,
  /** Crowded level (>20 creatures) OR heavy trail of chaos. */
  dungeonCrowdedEN: 8,
  /** Both conditions true. */
  dungeonBothEN: 7,
  /** EN is capped: an encounter can always be avoided on a good enough roll. */
  maxEN: 10,
  /** A 10 means the encounter lands immediately; 9 or lower gives a warning sign first. */
  immediateOn: 10
};

/** Treasure value bonus for finding loot early in a first visit (R p13). */
CROWS.greedBonus = { 1: 0.3, 2: 0.2, 3: 0.1 };

/* -------------------------------------------- */
/*  Light (R p15-16)                            */
/* -------------------------------------------- */

CROWS.lightLevels = {
  bright: "CROWS.LightBright",
  dim: "CROWS.LightDim",
  darkness: "CROWS.LightDarkness"
};

/** Campfire brightness by size, as [bright, dim] in squares (R p16). */
CROWS.campfires = {
  tiny: [0, 5],
  small: [5, 5],
  medium: [10, 10],
  large: [15, 15],
  huge: [20, 20]
};

/* -------------------------------------------- */
/*  Conditions (R p12)                          */
/* -------------------------------------------- */

/**
 * `endsAt: "dt"` conditions clear at the end of the dungeon turn, which the
 * dungeon-turn engine does automatically.
 */
CROWS.conditions = {
  blessed: { label: "CROWS.CondBlessed", icon: "icons/magic/holy/yin-yang-balance-symbol.webp", endsAt: "dt" },
  grabbed: { label: "CROWS.CondGrabbed", icon: "icons/magic/control/debuff-chains-ropes-red.webp" },
  prone: { label: "CROWS.CondProne", icon: "icons/magic/control/debuff-energy-hold-blue.webp" },
  vulnerable: { label: "CROWS.CondVulnerable", icon: "icons/magic/death/skull-energy-light-purple.webp", endsAt: "dt" },
  unconscious: { label: "CROWS.CondUnconscious", icon: "icons/magic/control/sleep-bubble-purple.webp" },
  weakened: { label: "CROWS.CondWeakened", icon: "icons/magic/control/debuff-body-blue.webp", endsAt: "dt" },
  surprised: { label: "CROWS.CondSurprised", icon: "icons/magic/perception/eye-ringed-glow-angry-red.webp" },
  hidden: { label: "CROWS.CondHidden", icon: "icons/magic/perception/silhouette-stealth-shadow.webp" }
};

/** Extra damage taken per instance of damage while vulnerable (R p12). */
CROWS.vulnerableBonus = "1d6";

/* -------------------------------------------- */
/*  Creatures (F p30)                           */
/* -------------------------------------------- */

CROWS.creatureCategories = {
  monster: "CROWS.CategoryMonster",
  human: "CROWS.CategoryHuman",
  animal: "CROWS.CategoryAnimal"
};

/**
 * Likes and hates are properties of the monster TYPE, not the individual, and
 * they are a real tactical lever: bait an ambush, or slip past something that
 * would otherwise eat you (F p30).
 *
 * Playtest 2 only prints likes/hates for blood creatures and undead. The other
 * four types are described but not yet statted, so their entries are
 * intentionally empty rather than invented.
 */
CROWS.monsterTypes = {
  angel: { label: "CROWS.TypeAngel", likes: "", hates: "" },
  blood: {
    label: "CROWS.TypeBlood",
    likes:
      "Large quantities of animal or human blood (a gallon or more), the scent of iron, and the sound of dripping liquid.",
    hates:
      "Dry bones without any flesh, containers holding large quantities of clean freshwater (a gallon or more), and soap."
  },
  demon: { label: "CROWS.TypeDemon", likes: "", hates: "" },
  plant: { label: "CROWS.TypePlant", likes: "", hates: "" },
  undead: {
    label: "CROWS.TypeUndead",
    likes:
      "Images, sounds, and smells that could remind them of the people they loved most in life, animal and human corpses dead less than 24 hours, cold temperatures, and the scent of wet earth.",
    hates:
      "Images, sounds, and smells that could remind them of the people they hated most in life, iconography of the gods, a fire the size of a bonfire or larger, and stained glass art."
  },
  unique: { label: "CROWS.TypeUnique", likes: "", hates: "" }
};

/** True of every monster regardless of type (F p30). */
CROWS.universalMonsterDrives = {
  likes: "Living, vulnerable prey, and the distress sounds of animals and humans.",
  hates: "Dying — a monster will not chase a hate while crows are actively killing it."
};

/** Monsters ignore dim light and darkness penalties entirely (F p30). */
CROWS.monstersIgnoreDarkness = true;

/**
 * Token sight range for monsters, in feet. Generous rather than infinite: it
 * expresses "darkness is no penalty" (F p30) without revealing the far side of
 * a dungeon the moment a monster token is dropped.
 */
CROWS.monsterSightRange = 60;

/**
 * A monster with power <= this may flee rather than engage something it hates
 * when confronted with an overwhelming amount of it (F p30).
 */
CROWS.weakMonsterPowerMax = 9;

/* -------------------------------------------- */
/*  Advancement (C p6-7)                        */
/* -------------------------------------------- */

/**
 * Total XP thresholds granting an Expertise & Stamina bonus, paired with the
 * maximum uses a single expertise may hold at that point.
 */
CROWS.expertiseAdvancement = [
  { txp: 100, maxUses: 2 },
  { txp: 500, maxUses: 2 },
  { txp: 1250, maxUses: 2 },
  { txp: 2250, maxUses: 2 },
  { txp: 3500, maxUses: 2 },
  { txp: 5000, maxUses: 3 },
  { txp: 10000, maxUses: 3 },
  { txp: 20000, maxUses: 4 },
  { txp: 30000, maxUses: 4 }
];

/** After the table above, another bonus every this many TXP (max uses stays 4). */
CROWS.expertiseAdvancementStep = 30000;
CROWS.expertiseMaxUsesCap = 4;

/**
 * Each bonus grants 3 expertise uses, or +2 max Stamina, or 1 use and +1 Stamina.
 *
 * The third option is printed as "Gain one expertise uses as described above,
 * and increase your Stamina maximum by 1" — singular "one" against plural
 * "uses", and against the other two packages (3 uses, or 2 Stamina) it is
 * strictly the worst pick on the menu, so nobody should ever take it. It looks
 * like a number edited down and not fully corrected.
 *
 * CLIFF'S RULING (2026-08-23): implement it AS PRINTED and raise it on the
 * MCDM playtest survey. Do not quietly "fix" a printed rule.
 */
CROWS.expertiseBonusOptions = {
  expertise: { uses: 3, stamina: 0 },
  stamina: { uses: 0, stamina: 2 },
  split: { uses: 1, stamina: 1 }
};

/** Total XP thresholds granting +1 to a characteristic (max 4). */
CROWS.characteristicAdvancement = [5000, 15000, 30000];
CROWS.characteristicAdvancementStep = 30000;

/** Starting traits sit at the top of a tree; every trait is bought once. */
CROWS.traitStartingCost = 500;

/** The 23 trait trees (C p7). */
CROWS.traitTrees = {
  alchemy: "CROWS.TreeAlchemy",
  alteration: "CROWS.TreeAlteration",
  archery: "CROWS.TreeArchery",
  armor: "CROWS.TreeArmor",
  bashing: "CROWS.TreeBashing",
  benefaction: "CROWS.TreeBenefaction",
  blacksmithing: "CROWS.TreeBlacksmithing",
  camping: "CROWS.TreeCamping",
  chopping: "CROWS.TreeChopping",
  conjuration: "CROWS.TreeConjuration",
  elemental: "CROWS.TreeElemental",
  enchantment: "CROWS.TreeEnchantment",
  illusion: "CROWS.TreeIllusion",
  knowledge: "CROWS.TreeKnowledge",
  leverage: "CROWS.TreeLeverage",
  necromancy: "CROWS.TreeNecromancy",
  pets: "CROWS.TreePets",
  reputation: "CROWS.TreeReputation",
  slashing: "CROWS.TreeSlashing",
  stabbing: "CROWS.TreeStabbing",
  thievery: "CROWS.TreeThievery",
  travel: "CROWS.TreeTravel",
  unarmed: "CROWS.TreeUnarmed"
};

/* -------------------------------------------- */
/*  Character creation (C p1)                   */
/* -------------------------------------------- */

CROWS.creation = {
  startingSpeed: 5,
  /**
   * The per-expertise cap before the first bonus (under 100 TXP).
   *
   * NOT STATED IN THE BOOK — the advancement table's first row is 100 TXP, so
   * a fresh crow has no printed cap. 2 is the only reading consistent with the
   * text: no background grants more than 2 uses in one expertise, and 2 is the
   * cap for the whole first five bonuses. Flagged for the playtest survey.
   */
  startingMaxUses: 2,
  /** Every PC starts with these regardless of background. */
  startingGold: "3d6",
  freeEquipment: ["coin purse", "knife", "rope", "rations (6)"],
  /** Background sets one characteristic to 2; the rest are {1,0} or {2,-1}. */
  characteristicSpreads: [
    [1, 0],
    [2, -1]
  ]
};

/* -------------------------------------------- */
/*  Overland travel (R p24-27)                  */
/* -------------------------------------------- */

CROWS.travelPaces = {
  slow: { label: "CROWS.PaceSlow", hexes: 1, en: 8, roleMod: "edge" },
  normal: { label: "CROWS.PaceNormal", hexes: 2, en: 7, roleMod: null },
  fast: { label: "CROWS.PaceFast", hexes: 3, en: 6, roleMod: "bane" }
};

CROWS.hexMiles = 5;

CROWS.travelRoles = {
  supporter: {
    label: "CROWS.RoleSupporter",
    max: 3,
    tasks: ["fightMiasma", "makeCamp", "supportEveryone"]
  },
  guide: {
    label: "CROWS.RoleGuide",
    max: 1,
    tasks: ["normalRoute", "safeRoute", "shortcut", "backOnTrack"]
  },
  scout: {
    label: "CROWS.RoleScout",
    max: 3,
    tasks: ["scoutDanger", "scoutShelter", "treasureHunt"]
  },
  tracker: {
    label: "CROWS.RoleTracker",
    max: 3,
    tasks: ["forage", "hunt", "trackCreature"]
  }
};

/** Group pace shifts by the slowest member's speed (R p24). */
CROWS.paceSpeedAdjustments = [
  { maxSpeed: 3, hexDelta: -1 },
  { minSpeed: 7, maxSpeed: 9, hexDelta: 1 },
  { minSpeed: 10, hexDelta: 2 }
];

/* -------------------------------------------- */
/*  Miasma (R p27-28)                           */
/* -------------------------------------------- */

CROWS.miasma = {
  /** Resisted with a Mind test after every rest spent in the Miasma. */
  characteristic: "mind",
  /** Each level of cruelty is a -1 to the resistance roll. */
  penaltyPerCruelty: -1,
  /** Effects are rolled as 1d10 + current cruelty. */
  effectFormula: "1d10",
  /** At this result or higher the crow is permanently lost and becomes an NPC. */
  lostThreshold: 13,
  /** Resting in the Miasma does not restore expertise uses. */
  blocksExpertiseRecovery: true
};

/* -------------------------------------------- */
/*  Crafting (R p36)                            */
/* -------------------------------------------- */

CROWS.crafting = {
  /** A crafting roll is a Mind test with no tiers; the total becomes points. */
  characteristic: "mind",
  /** Even a bad roll yields at least this, unless it is a doom. */
  minimumPoints: 1,
  /** A doom yields nothing. */
  doomPoints: 0,
  /** Double edge or an applied expertise is a flat bonus here, not a tier shift. */
  doubleEdgeBonus: 4,
  doubleBanePenalty: -4,
  maxExpertisesPerRoll: 2
};

CROWS.craftTools = {
  alchemist: "CROWS.ToolAlchemist",
  blacksmith: "CROWS.ToolBlacksmith",
  enchanter: "CROWS.ToolEnchanter"
};

/** Tool quality tiers sold by village institutions. */
CROWS.toolQualities = {
  standard: { label: "CROWS.QualityStandard", bonus: 0 },
  fine: { label: "CROWS.QualityFine", bonus: 1 },
  masterwork: { label: "CROWS.QualityMasterwork", bonus: 2 }
};

/* -------------------------------------------- */
/*  Rest (R p14-15)                             */
/* -------------------------------------------- */

CROWS.rest = {
  hours: 6,
  sleepHours: 4,
  rationsRequired: 1,
  /** Wounds removed by a completed rest. */
  woundsHealed: 1,
  /** Tend Wounds raises that to this for one ally. */
  tendWoundsHealed: 2,
  /** Rest activities available in a village without sleeping. */
  townActivitiesPerDay: 4
};

CROWS.restActivities = {
  craft: "CROWS.RestCraft",
  harvest: "CROWS.RestHarvest",
  identify: "CROWS.RestIdentify",
  prepare: "CROWS.RestPrepare",
  repairArmor: "CROWS.RestRepairArmor",
  secludeCamp: "CROWS.RestSecludeCamp",
  tendWounds: "CROWS.RestTendWounds"
};

/** Prepare for Task grants this bonus until the next rest (R p15). */
CROWS.prepareBonus = 2;

/* -------------------------------------------- */
/*  Weapons (item cards)                        */
/* -------------------------------------------- */

CROWS.weaponGroups = {
  bashing: "CROWS.GroupBashing",
  bow: "CROWS.GroupBow",
  chopping: "CROWS.GroupChopping",
  slashing: "CROWS.GroupSlashing",
  stabbing: "CROWS.GroupStabbing",
  unarmed: "CROWS.GroupUnarmed"
};

/**
 * Weapon properties printed on the cards. `parry N` and similar carry a value,
 * so a weapon stores properties as {key, value}.
 */
CROWS.weaponProperties = {
  light: "CROWS.PropLight",
  pummeling: "CROWS.PropPummeling",
  disengage: "CROWS.PropDisengage",
  parry: "CROWS.PropParry",
  dismember: "CROWS.PropDismember",
  brutal: "CROWS.PropBrutal",
  reach: "CROWS.PropReach",
  twoHanded: "CROWS.PropTwoHanded",
  thrown: "CROWS.PropThrown",
  loading: "CROWS.PropLoading"
};

CROWS.armorCategories = {
  light: "CROWS.ArmorLight",
  heavy: "CROWS.ArmorHeavy",
  shield: "CROWS.ArmorShield"
};

/* -------------------------------------------- */
/*  Combat (R p18-23)                           */
/* -------------------------------------------- */

CROWS.combat = {
  /** Each square on the grid is 5 feet across (R p18). */
  feetPerSquare: 5,
  /** Side-based initiative: one player rolls 1d10 at the start of every round. */
  initiativeFormula: "1d10",
  /** On this result or higher the crows act first. */
  playersFirstOn: 6,
  /** Baseline reactions per round; some creatures have more. */
  reactionsPerRound: 1,
  /** Attacks against a surprised or squeezing creature. */
  surprisedAttackBonus: 1,
  squeezingAttackBonus: 1,
  /** Ranged attacks past normal range. */
  longRangePenaltyPerSquare: -2
};

/** Unarmed strike, available to every creature (R p20). */
CROWS.unarmedStrike = {
  characteristic: "agilityOrStrength",
  tier2: "1 + @mod",
  tier3: "2 + @mod"
};

/** Falling: 1d6 piercing per 10 feet (R p16). */
CROWS.falling = { perFeet: 10, damage: "1d6", piercing: true };

/** Suffocation: hold breath for 3 + Strength rounds, then 1d6 per round (R p16). */
CROWS.suffocation = { baseRounds: 3, damage: "1d6" };

/** Toppling an object onto a creature (R p23). */
CROWS.toppling = { base: "1d10", perSizeLarger: "2d10" };

export default CROWS;
