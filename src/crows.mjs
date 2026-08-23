/**
 * Crows — system entry point.
 *
 * Unofficial Foundry VTT system for MCDM's Crows (public playtest 2).
 */

import "../styles/crows.css";

import { CROWS } from "./config.mjs";
import { resolveDamageRecipients } from "./system/damage-math.mjs";

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
  // The clock is permanent furniture, so it goes up on load rather than
  // waiting for someone to think to open it.
  DungeonTurnPanel.show();
});

/**
 * Foundry re-rendering the player list replaces the node the HUD docks against,
 * which can leave the HUD stranded above the scene controls instead. Putting it
 * back is cheaper than watching for it.
 */
Hooks.on("renderPlayers", () => DungeonTurnPanel.reinsert());

/* -------------------------------------------- */
/*  Scene controls                              */
/* -------------------------------------------- */

/**
 * A dungeon-turn button on the token toolbar.
 *
 * The clock now lives permanently above the player list, so this no longer
 * opens anything — it expands the HUD for someone who collapsed it and then
 * forgot where the bar went. In v14 `controls` and `tools` are Records keyed by
 * name, not arrays.
 */
Hooks.on("getSceneControlButtons", (controls) => {
  const tokens = controls.tokens;
  if (!tokens) return;

  tokens.tools.crowsDungeonTurn = {
    name: "crowsDungeonTurn",
    order: 100,
    title: "CROWS.ExpandClock",
    icon: "fa-solid fa-hourglass-half",
    button: true,
    // Players get the button only when the world lets them watch the clock.
    visible: game.user.isGM || game.settings.get(CROWS.id, "showTurnClockToPlayers"),
    onChange: async () => {
      await game.settings.set(CROWS.id, "turnHudCollapsed", false);
      DungeonTurnPanel.show();
    }
  };

  /**
   * Awarding treasure, which is the ONLY thing that earns XP (C p6).
   *
   * It needs a home the Ref can reach mid-delve without opening a sheet,
   * because it fires the moment the party hauls something out — that is the
   * level-up event, and until it existed nothing marked one.
   */
  tokens.tools.crowsAwardTreasure = {
    name: "crowsAwardTreasure",
    order: 101,
    title: "CROWS.AwardTreasure",
    icon: "fa-solid fa-sack-dollar",
    button: true,
    visible: game.user.isGM,
    onChange: async () => {
      const { TreasureAward } = await import("./apps/treasure-award.mjs");
      return new TreasureAward().render({ force: true });
    }
  };
});

/* -------------------------------------------- */
/*  Carried light                               */
/* -------------------------------------------- */

/**
 * A crow's token light follows whatever light source is in their hands, so
 * drawing a torch opens the dark and letting it burn out closes it again.
 * Item hooks cover every route: equipping, moving between slots, spending
 * usage dice at the end of a dungeon turn, and dropping it.
 */
for (const hook of ["createItem", "updateItem", "deleteItem"]) {
  Hooks.on(hook, (item) => {
    const actor = item.parent;
    if (!(actor instanceof Actor) || actor.type !== "crow") return;
    if (!actor.isOwner) return;
    actor.syncCarriedLight();
  });
}

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

          /**
           * Targets first, selection second.
           *
           * This used to read `canvas.tokens.controlled` alone, so a crow who
           * had targeted a monster while their own token was still selected
           * applied their own axe crit to themselves.
           */
          const { tokens, usedTargets, selfHit, empty } = resolveDamageRecipients({
            targets: Array.from(game.user?.targets ?? []),
            controlled: canvas.tokens?.controlled ?? [],
            sourceActorId: message.speaker?.actor ?? null
          });

          if (empty) return ui.notifications.warn(game.i18n.localize("CROWS.SelectTargets"));

          // Damaging only the roll's own actor is legal but rarely intended.
          if (selfHit) {
            const ok = await foundry.applications.api.DialogV2.confirm({
              window: { title: game.i18n.localize("CROWS.ConfirmSelfDamage") },
              content: `<p>${game.i18n.format("CROWS.ConfirmSelfDamageHint", {
                name: tokens[0]?.name ?? "", amount
              })}</p>`,
              rejectClose: false
            });
            if (!ok) return;
          }

          for (const token of tokens) await token.actor?.applyDamage(amount, { piercing });

          ui.notifications.info(
            game.i18n.format(usedTargets ? "CROWS.DamagedTargets" : "CROWS.DamagedSelected", {
              n: tokens.length, amount, names: tokens.map((t) => t.name).join(", ")
            })
          );
          return;
        }

        default:
          return null;
      }
    });
  });
});
