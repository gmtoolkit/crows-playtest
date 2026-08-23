import { CROWS } from "../config.mjs";

/**
 * The rest gate, from the other direction.
 *
 * "You can only spend XP or gain bonuses from TXP when you finish a rest after
 * earning the XP" (C p6). A crow who has earned XP since their last rest has
 * not slept on it yet, so the spending screens are not open to them.
 *
 * Rather than refuse, this offers the rest — because a player who opens the
 * advancement screen has already decided they want to spend, and making them
 * close it, find the Rest button and come back teaches nothing. The warning is
 * explicit that a rest is a real event with real effects: Stamina refills, a
 * wound closes, expertise uses come back, and Prepare for Task expires. That
 * last set is why this asks rather than resting silently.
 */
export async function ensureRested(actor) {
  if (!actor || actor.type !== "crow") return true;
  if (!actor.system.advancement.restOwed) return true;

  const { DialogV2 } = foundry.applications.api;
  const unsettled = actor.system.advancement.unsettledTxp;

  const proceed = await DialogV2.confirm({
    window: { title: game.i18n.localize("CROWS.RestRequired") },
    content:
      `<p>${game.i18n.format("CROWS.RestRequiredHint", { xp: unsettled })}</p>` +
      `<p class="notification warning">${game.i18n.localize("CROWS.RestRequiredWarning")}</p>`,
    yes: { label: game.i18n.localize("CROWS.RestNow") },
    no: { label: game.i18n.localize("CROWS.Cancel") },
    rejectClose: false
  });
  if (!proceed) return false;

  // Ask the Miasma question the same way the Rest button does — resting in the
  // Miasma withholds expertise recovery (R p27), and a rest triggered from a
  // side door must not quietly assume shelter.
  const inMiasma = await DialogV2.confirm({
    window: { title: game.i18n.localize("CROWS.Rest") },
    content: `<p>${game.i18n.localize("CROWS.RestInMiasmaPrompt")}</p>`,
    yes: { label: game.i18n.localize("CROWS.InTheMiasma") },
    no: { label: game.i18n.localize("CROWS.Sheltered") },
    rejectClose: false
  });

  await actor.rest({ inMiasma: !!inMiasma });
  return true;
}

/** Whether this crow has anything at all worth opening an advancement screen for. */
export function hasSomethingToSpend(actor) {
  const adv = actor?.system?.advancement;
  if (!adv) return false;
  return adv.available > 0 || adv.charAvailable > 0 || actor.system.xp.available >= CROWS.traitStartingCost;
}
