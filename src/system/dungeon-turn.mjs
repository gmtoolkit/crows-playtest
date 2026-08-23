import { CROWS } from "../config.mjs";
import { resolveEncounterCheck } from "../dice/tiers.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The dungeon turn (R p13-14) — Crows' signature loop.
 *
 * A dungeon turn is THIRTY MINUTES OF REAL TIME, not fictional time. When it
 * ends, torches burn down, ongoing spells tick, and the Ref checks for a
 * wandering monster. The pressure is the point: standing around debating costs
 * you the same clock that walking into the dark does.
 *
 * State lives in a world setting rather than a socket broadcast so that the
 * clock survives a refresh and late-joining players see the correct time.
 */
export class DungeonTurn {
  static #interval = null;

  static get state() {
    return game.settings.get(CROWS.id, "dungeonTurnState");
  }

  static get minutes() {
    return game.settings.get(CROWS.id, "dungeonTurnMinutes");
  }

  /** Milliseconds remaining in the current turn; 0 when elapsed or inactive. */
  static get remaining() {
    const s = this.state;
    if (!s.active) return 0;
    const now = s.paused ? s.pausedAt : Date.now();
    const elapsed = now - s.startedAt;
    return Math.max(0, this.minutes * 60_000 - elapsed);
  }

  static get elapsed() {
    const s = this.state;
    if (!s.active) return 0;
    const now = s.paused ? s.pausedAt : Date.now();
    return Math.max(0, now - s.startedAt);
  }

  /* -------------------------------------------- */

  /**
   * Start the ticker. Only the GM's client may end a turn, so that a table of
   * six players does not fire six simultaneous encounter checks.
   */
  static initialise() {
    if (this.#interval) clearInterval(this.#interval);
    this.#interval = setInterval(() => this.#tick(), 1000);

    // Re-render the panel whenever any client changes the shared state.
    Hooks.on("updateSetting", (setting) => {
      if (setting.key === `${CROWS.id}.dungeonTurnState`) DungeonTurnPanel.refresh();
    });

    /**
     * Pausing the game pauses the dungeon turn.
     *
     * "The timer shouldn't be stopped unless the group takes a break from play
     * or if the Ref wants to pause to explain or look up the rules" (R p13).
     * Foundry's pause button is exactly that signal, so the two should not be
     * tracked separately — a Ref who pauses to look something up should not
     * also have to remember the DT clock.
     */
    Hooks.on("pauseGame", async (paused) => {
      if (!game.user.isActiveGM) return;
      const s = this.state;
      if (!s.active) return;
      if (paused === s.paused) return;
      await this.togglePause();
    });

    // Players see the clock too, if the world allows it — the pressure only
    // works when the table can watch it run down.
    if (this.state.active && (game.user.isGM || game.settings.get(CROWS.id, "showTurnClockToPlayers"))) {
      DungeonTurnPanel.show();
    }
  }

  static async #tick() {
    const s = this.state;
    if (!s.active || s.paused) return;

    DungeonTurnPanel.refresh();

    // Audible warnings before the turn lands. A torch guttering out should not
    // be a surprise — the crows should hear the clock running down and get the
    // chance to spend their last minutes deliberately.
    this.#maybeWarn();

    // The GM alone advances the turn.
    if (game.user.isActiveGM && this.remaining <= 0) await this.endTurn();
  }

  /** Fire each warning threshold exactly once per turn. */
  static #warned = new Set();

  static #maybeWarn() {
    const minutesLeft = this.remaining / 60_000;
    const turn = this.state.turn;

    for (const threshold of CROWS.dungeonTurn.warnMinutes) {
      const key = `${turn}:${threshold}`;
      if (this.#warned.has(key)) continue;
      if (minutesLeft > threshold) continue;

      this.#warned.add(key);
      if (!game.settings.get(CROWS.id, "turnWarnings")) continue;

      // Foundry's i18n has no plural rules, so the singular gets its own
      // message rather than announcing "1 minutes left".
      const message = threshold === 1 ? "CROWS.DTWarningOne" : "CROWS.DTWarning";
      ui.notifications.warn(game.i18n.format(message, { minutes: threshold }));
      foundry.audio.AudioHelper.play(
        { src: "sounds/notify.wav", volume: 0.35, autoplay: true, loop: false },
        false
      );
    }
  }

  /** Forget the warnings fired for the turn that just ended. */
  static resetWarnings() {
    this.#warned.clear();
  }

  /* -------------------------------------------- */

  /** Begin dungeon exploration. */
  static async start({ label = "", en = CROWS.encounter.dungeonDefaultEN } = {}) {
    await game.settings.set(CROWS.id, "dungeonTurnState", {
      active: true,
      paused: false,
      startedAt: Date.now(),
      pausedAt: 0,
      turn: 1,
      en,
      label
    });
    this.resetWarnings();

    await ChatMessage.create({
      content: `<div class="crows-dt-banner"><h3>${game.i18n.format("CROWS.DTStarted", {
        label: label || game.i18n.localize("CROWS.TheDungeon")
      })}</h3><p>${game.i18n.format("CROWS.DTTurnLength", { minutes: this.minutes })}</p></div>`
    });
    DungeonTurnPanel.refresh();
  }

  static async stop() {
    const s = this.state;
    await game.settings.set(CROWS.id, "dungeonTurnState", { ...s, active: false, paused: false });
    await ChatMessage.create({ content: `<div class="crows-dt-banner">${game.i18n.localize("CROWS.DTStopped")}</div>` });
    DungeonTurnPanel.refresh();
  }

  static async togglePause() {
    const s = this.state;
    if (!s.active) return;

    if (s.paused) {
      // Shift the start forward by however long we were paused, so the
      // remaining time is preserved rather than the clock jumping.
      const pausedFor = Date.now() - s.pausedAt;
      await game.settings.set(CROWS.id, "dungeonTurnState", {
        ...s,
        paused: false,
        startedAt: s.startedAt + pausedFor,
        pausedAt: 0
      });
    } else {
      await game.settings.set(CROWS.id, "dungeonTurnState", { ...s, paused: true, pausedAt: Date.now() });
    }
    DungeonTurnPanel.refresh();
  }

  /** Adjust the encounter number. Remember: a HIGHER EN is SAFER. */
  static async setEN(en) {
    const s = this.state;
    await game.settings.set(CROWS.id, "dungeonTurnState", {
      ...s,
      en: Math.min(CROWS.encounter.maxEN, Math.max(1, en))
    });
    DungeonTurnPanel.refresh();
  }

  /* -------------------------------------------- */

  /**
   * End the current dungeon turn and begin the next.
   *
   * Order follows the rules (R p13): usage dice first, then the encounter
   * check. Doing it the other way round would let a monster arrive before the
   * torch that would have revealed it went out.
   */
  static async endTurn({ silent = false } = {}) {
    if (!game.user.isActiveGM) return;

    const s = this.state;
    if (!s.active) return;

    const lines = [];

    // 1. Usage dice and turn-expiring conditions, for every crow in the party.
    if (game.settings.get(CROWS.id, "autoUsageDice")) {
      for (const actor of this.partyActors()) {
        const results = await actor.endDungeonTurn();
        for (const { item, outcome } of results) {
          if (outcome?.exhausted) {
            lines.push(game.i18n.format("CROWS.UDExhausted", { item: `${actor.name}: ${item.name}` }));
          }
        }
      }
    }

    // 2. Encounter check.
    let encounter = null;
    if (game.settings.get(CROWS.id, "autoEncounterCheck")) encounter = await this.rollEncounterCheck(s.en);

    // 3. Advance.
    this.resetWarnings();
    await game.settings.set(CROWS.id, "dungeonTurnState", { ...s, turn: s.turn + 1, startedAt: Date.now() });

    if (!silent) {
      await ChatMessage.create({
        content: `<div class="crows-dt-banner">
            <h3>${game.i18n.format("CROWS.DTEnded", { turn: s.turn })}</h3>
            ${lines.length ? `<ul><li>${lines.join("</li><li>")}</li></ul>` : ""}
            <p class="dt-next">${game.i18n.format("CROWS.DTBegins", { turn: s.turn + 1 })}</p>
          </div>`
      });
    }

    if (game.settings.get(CROWS.id, "turnEndSound")) {
      foundry.audio.AudioHelper.play({ src: "sounds/notify.wav", volume: 0.6, autoplay: true, loop: false }, false);
    }

    DungeonTurnPanel.refresh();
    return { encounter };
  }

  /* -------------------------------------------- */

  /**
   * Roll 1d10 against the encounter number.
   *
   * An encounter occurs on a result AT OR ABOVE the EN, so raising the EN makes
   * the party safer — which is why Seclude Camp and Scout for Danger raise it
   * and a crowded dungeon lowers it.
   */
  static async rollEncounterCheck(en = null) {
    const target = en ?? this.state.en;
    const roll = await new Roll(CROWS.encounter.formula).evaluate();
    const outcome = resolveEncounterCheck(roll.total, target);

    let flavor;
    if (!outcome.occurs) flavor = game.i18n.format("CROWS.NoEncounter", { en: target });
    else if (outcome.immediate) flavor = game.i18n.localize("CROWS.EncounterImmediate");
    else flavor = game.i18n.localize("CROWS.EncounterWarning");

    await roll.toMessage({
      flavor,
      speaker: { alias: game.i18n.localize("CROWS.EncounterCheck") },
      // The Ref rolls this; players see the outcome, and the rules encourage
      // rolling in the open, so this is public by default.
      whisper: []
    });

    return { roll, ...outcome };
  }

  /* -------------------------------------------- */

  /** The crows currently in play: player-owned crow actors. */
  static partyActors() {
    const owned = game.actors.filter(
      (a) => a.type === "crow" && a.hasPlayerOwner
    );
    // Fall back to every crow if nobody has been assigned yet, so a solo Ref
    // testing the system still sees their torches burn.
    return owned.length ? owned : game.actors.filter((a) => a.type === "crow");
  }

  /** Greed bonus multiplier for treasure found this turn (R p13). */
  static greedMultiplier() {
    const turn = this.state.turn;
    return 1 + (CROWS.greedBonus[turn] ?? 0);
  }
}

/* -------------------------------------------- */
/*  Panel                                       */
/* -------------------------------------------- */

/**
 * The clock the whole table watches. Shown to players when
 * `showTurnClockToPlayers` is on, GM-only otherwise.
 */
export class DungeonTurnPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "crows-dungeon-turn",
    classes: ["crows", "dungeon-turn-panel"],
    tag: "aside",
    window: { title: "CROWS.DungeonTurn", icon: "fa-solid fa-hourglass-half", minimizable: true },
    position: { width: 280, height: "auto" },
    actions: {
      start: DungeonTurnPanel.#onStart,
      stop: DungeonTurnPanel.#onStop,
      pause: DungeonTurnPanel.#onPause,
      endTurn: DungeonTurnPanel.#onEndTurn,
      encounter: DungeonTurnPanel.#onEncounter,
      enUp: DungeonTurnPanel.#onENUp,
      enDown: DungeonTurnPanel.#onENDown
    }
  };

  static PARTS = {
    body: { template: "systems/crows/templates/apps/dungeon-turn.hbs" }
  };

  static #instance = null;

  /** Open (or focus) the panel. */
  static show() {
    this.#instance ??= new DungeonTurnPanel();
    return this.#instance.render({ force: true });
  }

  /** Re-render if open. Called every tick and on every state change. */
  static refresh() {
    if (this.#instance?.rendered) this.#instance.render(false);
  }

  /* -------------------------------------------- */

  async _prepareContext() {
    const s = DungeonTurn.state;
    const remaining = DungeonTurn.remaining;
    const total = DungeonTurn.minutes * 60_000;

    return {
      state: s,
      isGM: game.user.isGM,
      minutes: DungeonTurn.minutes,
      remainingText: formatClock(remaining),
      elapsedText: formatClock(DungeonTurn.elapsed),
      // Drains left to right as the turn burns down.
      progress: total ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0,
      urgent: remaining > 0 && remaining < 5 * 60_000,
      greed: CROWS.greedBonus[s.turn] ? Math.round(CROWS.greedBonus[s.turn] * 100) : 0
    };
  }

  /* -------------------------------------------- */

  static async #onStart() {
    const { DialogV2 } = foundry.applications.api;
    const label = await DialogV2.input({
      window: { title: game.i18n.localize("CROWS.StartDungeonTurn") },
      content: `<div class="form-group"><label>${game.i18n.localize(
        "CROWS.DungeonName"
      )}</label><input type="text" name="label" autofocus></div>`
    });
    if (label === null) return;
    return DungeonTurn.start({ label: label?.label ?? "" });
  }

  static async #onStop() {
    return DungeonTurn.stop();
  }

  static async #onPause() {
    return DungeonTurn.togglePause();
  }

  static async #onEndTurn() {
    return DungeonTurn.endTurn();
  }

  static async #onEncounter() {
    return DungeonTurn.rollEncounterCheck();
  }

  static async #onENUp() {
    return DungeonTurn.setEN(DungeonTurn.state.en + 1);
  }

  static async #onENDown() {
    return DungeonTurn.setEN(DungeonTurn.state.en - 1);
  }
}

/** mm:ss for a millisecond duration. */
function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default DungeonTurn;
