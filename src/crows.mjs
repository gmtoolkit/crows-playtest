/**
 * Crows — system entry point.
 *
 * Unofficial Foundry VTT system for MCDM's Crows (public playtest 2).
 */

import "../styles/crows.css";

import { CROWS } from "./config.mjs";

import CrowData from "./data/actor-crow.mjs";
import CreatureData from "./data/actor-creature.mjs";
import GearData from "./data/item-gear.mjs";
import WeaponData from "./data/item-weapon.mjs";
import ArmorData from "./data/item-armor.mjs";
import SpellbookData from "./data/item-spellbook.mjs";
import TraitData from "./data/item-trait.mjs";
import BackgroundData from "./data/item-background.mjs";
import AttackData from "./data/item-attack.mjs";
import FeatureData from "./data/item-feature.mjs";

import CrowsActor from "./documents/actor.mjs";
import CrowsItem from "./documents/item.mjs";

import CrowSheet from "./apps/crow-sheet.mjs";
import CreatureSheet from "./apps/creature-sheet.mjs";
import CrowsItemSheet from "./apps/item-sheet.mjs";

import { PowerRoll } from "./dice/power-roll.mjs";
import { DungeonTurn, DungeonTurnPanel } from "./system/dungeon-turn.mjs";
import { registerSettings } from "./system/settings.mjs";
import { registerHandlebars } from "./system/handlebars.mjs";
import { CrowsCombat } from "./system/combat.mjs";

const SYSTEM_ID = CROWS.id;

/* -------------------------------------------- */
/*  Init                                        */
/* -------------------------------------------- */

Hooks.once("init", () => {
  console.log("crows | initialising Crows system");

  CONFIG.CROWS = CROWS;

  // Document classes
  CONFIG.Actor.documentClass = CrowsActor;
  CONFIG.Item.documentClass = CrowsItem;
  CONFIG.Combat.documentClass = CrowsCombat;

  // Data models — declared in system.json documentTypes, implemented here.
  CONFIG.Actor.dataModels = {
    crow: CrowData,
    creature: CreatureData
  };
  CONFIG.Item.dataModels = {
    gear: GearData,
    weapon: WeaponData,
    armor: ArmorData,
    spellbook: SpellbookData,
    trait: TraitData,
    background: BackgroundData,
    attack: AttackData,
    feature: FeatureData
  };

  /**
   * Combat in Crows has no per-creature initiative: one player rolls 1d10 at
   * the start of every round and a 6 or higher gives the crows the first turn
   * (R p18). The tracker is therefore side-based, handled in CrowsCombat.
   */
  CONFIG.Combat.initiative = { formula: CROWS.combat.initiativeFormula, decimals: 0 };

  // Status effects mirror the conditions table (R p12).
  CONFIG.statusEffects = Object.entries(CROWS.conditions).map(([id, c]) => ({
    id,
    _id: `crowscond${id}`.padEnd(16, "0").slice(0, 16),
    name: c.label,
    img: c.icon,
    flags: { [SYSTEM_ID]: { condition: id } }
  }));

  registerSettings();
  registerHandlebars();
  registerSheets();

  // Expose a small API for macros and for debugging at the console.
  game.crows = {
    CROWS,
    PowerRoll,
    DungeonTurn,
    DungeonTurnPanel,
    documents: { CrowsActor, CrowsItem }
  };
});

/* -------------------------------------------- */

function registerSheets() {
  const { DocumentSheetConfig } = foundry.applications.apps;

  DocumentSheetConfig.unregisterSheet(Actor, "core", foundry.applications.sheets.ActorSheetV2);
  DocumentSheetConfig.registerSheet(Actor, SYSTEM_ID, CrowSheet, {
    types: ["crow"],
    makeDefault: true,
    label: "CROWS.SheetCrow"
  });
  DocumentSheetConfig.registerSheet(Actor, SYSTEM_ID, CreatureSheet, {
    types: ["creature"],
    makeDefault: true,
    label: "CROWS.SheetCreature"
  });

  DocumentSheetConfig.unregisterSheet(Item, "core", foundry.applications.sheets.ItemSheetV2);
  DocumentSheetConfig.registerSheet(Item, SYSTEM_ID, CrowsItemSheet, {
    makeDefault: true,
    label: "CROWS.SheetItem"
  });
}

/* -------------------------------------------- */
/*  Ready                                       */
/* -------------------------------------------- */

Hooks.once("ready", () => {
  DungeonTurn.initialise();
});

/* -------------------------------------------- */
/*  Scene controls                              */
/* -------------------------------------------- */

/**
 * A dungeon-turn button on the token toolbar.
 *
 * The clock is the game's central mechanic, so reaching it should not require
 * opening a character sheet first. In v14 `controls` and `tools` are Records
 * keyed by name, not arrays.
 */
Hooks.on("getSceneControlButtons", (controls) => {
  const tokens = controls.tokens;
  if (!tokens) return;

  tokens.tools.crowsDungeonTurn = {
    name: "crowsDungeonTurn",
    order: 100,
    title: "CROWS.DungeonTurn",
    icon: "fa-solid fa-hourglass-half",
    button: true,
    // Players get the button only when the world lets them watch the clock.
    visible: game.user.isGM || game.settings.get(CROWS.id, "showTurnClockToPlayers"),
    onChange: () => DungeonTurnPanel.show()
  };
});

/* -------------------------------------------- */
/*  Chat card interactions                      */
/* -------------------------------------------- */

Hooks.on("renderChatMessageHTML", (message, html) => {
  html.querySelectorAll("[data-crows-action]").forEach((el) => {
    el.addEventListener("click", async (event) => {
      event.preventDefault();
      const action = el.dataset.crowsAction;

      switch (action) {
        case "applyExpertise":
          return PowerRoll.applyExpertise(message);

        case "applyDamage": {
          const amount = Number(el.dataset.amount) || 0;
          const piercing = el.dataset.piercing === "true";
          const targets = canvas.tokens?.controlled ?? [];
          if (!targets.length) return ui.notifications.warn(game.i18n.localize("CROWS.SelectTargets"));
          for (const token of targets) await token.actor?.applyDamage(amount, { piercing });
          return;
        }

        default:
          return null;
      }
    });
  });
});
