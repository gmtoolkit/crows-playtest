import { CROWS } from "../config.mjs";

/**
 * Dragging a card to the hotbar, and using it from there.
 *
 * A weapon, a spellbook and a wand of exploding whatever all resolve through
 * `item.use()`, so one macro shape covers every card a crow can carry.
 *
 * WHY THE MACRO STORES A NAME AND NOT A UUID. An item's UUID is bound to the
 * actor it sits on, and a hotbar is bound to the USER. A Ref who drags a
 * torch from one crow's sheet and later selects a different crow wants the
 * macro to act on whoever is selected, the way every other system's item
 * macros behave — otherwise the bar quietly keeps firing at an actor who is
 * not in the scene. Resolving by name against the current actor is what makes
 * one bar work across a party.
 */

/** Find the actor a hotbar macro should act on, in the order a user expects. */
export function macroActor() {
  // The token you have selected wins: it is the most explicit statement of
  // "this one", and a Ref running four crows relies on it.
  const controlled = canvas?.tokens?.controlled ?? [];
  if (controlled.length === 1 && controlled[0].actor) return controlled[0].actor;

  // Otherwise the character assigned to this user.
  if (game.user?.character) return game.user.character;

  // A single controlled token of several is ambiguous; say so rather than guess.
  return null;
}

/**
 * Use a carried item by name.
 *
 * Named rather than referenced so the macro follows the selected crow. A miss
 * reports WHAT it was looking for and WHO it looked at, because "nothing
 * happened" on a hotbar press is impossible to diagnose from the table.
 */
export async function useItemMacro(itemName) {
  const actor = macroActor();
  if (!actor) {
    return ui.notifications.warn(game.i18n.localize("CROWS.MacroNoActor"));
  }

  const item = actor.items.find((i) => i.name === itemName);
  if (!item) {
    return ui.notifications.warn(
      game.i18n.format("CROWS.MacroNoItem", { item: itemName, name: actor.name })
    );
  }

  return item.use();
}

/**
 * Build (or reuse) a hotbar macro for a dropped item.
 *
 * Reused rather than duplicated: dragging the same card twice should not leave
 * two macros with the same name cluttering the directory.
 */
export async function createItemMacro(data, slot) {
  const name = data?.crows?.name;
  if (!name) return true; // Not one of ours; let Foundry handle it.

  const command = `game.crows.useItemMacro(${JSON.stringify(name)});`;
  let macro = game.macros.find((m) => m.name === name && m.command === command);

  if (!macro) {
    macro = await Macro.create({
      name,
      type: "script",
      img: data.crows.img,
      command,
      flags: { [CROWS.id]: { itemMacro: true } }
    });
  }

  await game.user.assignHotbarMacro(macro, slot);
  return false; // We handled the drop.
}
