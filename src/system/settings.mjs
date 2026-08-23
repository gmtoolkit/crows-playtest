import { CROWS } from "../config.mjs";

/** World and client settings. */
export function registerSettings() {
  const id = CROWS.id;

  /**
   * The wording of the wound speed penalty (R p12) genuinely parses two ways —
   * see DECISIONS.md. Default to the strict reading, which is the only one that
   * does not floor a fresh crow at speed 0 the moment they pack their bag.
   */
  game.settings.register(id, "woundSpeedRule", {
    name: "CROWS.Settings.WoundSpeedRule",
    hint: "CROWS.Settings.WoundSpeedRuleHint",
    scope: "world",
    config: true,
    type: String,
    default: "both",
    choices: {
      both: "CROWS.Settings.WoundSpeedBoth",
      either: "CROWS.Settings.WoundSpeedEither"
    },
    onChange: () => {
      // Speed is derived from this, so every crow needs re-preparing.
      for (const actor of game.actors) if (actor.type === "crow") actor.prepareData();
      Object.values(ui.windows ?? {}).forEach((w) => w.render?.(false));
    }
  });

  /** Dungeon turn length. The rules offer 20, 30 (default), or 60 minutes. */
  game.settings.register(id, "dungeonTurnMinutes", {
    name: "CROWS.Settings.DungeonTurnMinutes",
    hint: "CROWS.Settings.DungeonTurnMinutesHint",
    scope: "world",
    config: true,
    type: Number,
    default: CROWS.dungeonTurn.defaultMinutes,
    range: { min: 5, max: 120, step: 5 }
  });

  /**
   * Persistent dungeon-turn state. Stored as a world setting rather than
   * broadcast over a socket so late-joining clients see the correct clock and
   * a browser refresh does not lose the turn.
   */
  game.settings.register(id, "dungeonTurnState", {
    scope: "world",
    config: false,
    type: Object,
    default: {
      active: false,
      paused: false,
      startedAt: 0,
      pausedAt: 0,
      turn: 0,
      en: CROWS.encounter.dungeonDefaultEN,
      label: ""
    }
  });

  /** Show the dungeon-turn clock to players, not just the Ref. */
  game.settings.register(id, "showTurnClockToPlayers", {
    name: "CROWS.Settings.ShowClock",
    hint: "CROWS.Settings.ShowClockHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: async () => {
      const { DungeonTurnPanel } = await import("./dungeon-turn.mjs");
      if (DungeonTurnPanel.visibleToUser) DungeonTurnPanel.show();
      else await DungeonTurnPanel.teardown();
    }
  });

  /**
   * Whether this client has the turn clock collapsed to a bar.
   *
   * Client-scoped and hidden from the settings sheet: it is a UI state the
   * user sets by clicking the thing, not a preference they go looking for. A
   * player collapsing their clock must not collapse the Ref's.
   */
  game.settings.register(id, "turnHudCollapsed", {
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });

  /**
   * Whether ending a dungeon turn rolls the encounter check automatically.
   * Some Refs prefer to roll it themselves, in the open, at the table.
   */
  game.settings.register(id, "autoEncounterCheck", {
    name: "CROWS.Settings.AutoEncounterCheck",
    hint: "CROWS.Settings.AutoEncounterCheckHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  /** Whether ending a dungeon turn rolls every DT-triggered usage-dice pool. */
  game.settings.register(id, "autoUsageDice", {
    name: "CROWS.Settings.AutoUsageDice",
    hint: "CROWS.Settings.AutoUsageDiceHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  /** Warn the table as the turn runs down (10, 5 and 1 minutes remaining). */
  game.settings.register(id, "turnWarnings", {
    name: "CROWS.Settings.TurnWarnings",
    hint: "CROWS.Settings.TurnWarningsHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  /**
   * How equipment reaches a crow.
   *
   * Note what this does NOT gate: browsing. A player can always open the
   * catalogue and read every card, in either mode. Hiding the catalogue would
   * stop them planning, saving up, or asking the Ref for anything by name, and
   * "you cannot see it" is a much worse table experience than "you cannot
   * afford it yet".
   */
  game.settings.register(id, "itemAcquisition", {
    name: "CROWS.Settings.ItemAcquisition",
    hint: "CROWS.Settings.ItemAcquisitionHint",
    scope: "world",
    config: true,
    type: String,
    default: "purchase",
    choices: {
      purchase: "CROWS.Settings.AcquisitionPurchase",
      gm: "CROWS.Settings.AcquisitionGM"
    }
  });

  /**
   * Offer "knock unconscious instead" when a blow would kill a creature.
   *
   * DEFAULT OFF, because a prompt on every kill is friction in a fight and
   * 0 Stamina meaning dead is the rule. R p12 makes this an ASK ("you can ask
   * the Ref"), not an automatic step — and when granted the creature sits at
   * ONE Stamina, never zero, because zero is what dead is.
   */
  game.settings.register(id, "askKnockUnconscious", {
    name: "CROWS.Settings.AskKnockUnconscious",
    hint: "CROWS.Settings.AskKnockUnconsciousHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  /** Play a sound when a dungeon turn ends. Torches going out should sting. */
  game.settings.register(id, "turnEndSound", {
    name: "CROWS.Settings.TurnEndSound",
    hint: "CROWS.Settings.TurnEndSoundHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
}
