/**
 * Shared helpers for the document-control bar on the actor sheets.
 *
 * Foundry v13+ hides the prototype-token, token, ownership and sheet-config
 * controls behind the window header's overflow menu. Those are things a Ref
 * reaches for constantly, so both sheets surface them as buttons instead. The
 * buttons bind to action names ActorSheetV2 and DocumentSheetV2 already
 * register — only the placed-token lookup below needs code of its own.
 */

/**
 * The token on the canvas that represents this actor, if there is one.
 *
 * Preference order matters: a selected token first (the Ref clicked it, so it
 * is the one they mean), then the token this sheet was opened from, then any
 * token of this actor on the active scene.
 *
 * @param {Actor} actor
 * @returns {TokenDocument|null}
 */
export function placedTokenFor(actor) {
  if (!actor) return null;

  const selected = canvas?.tokens?.controlled?.find((t) => t.actor?.id === actor.id);
  if (selected) return selected.document;

  // A sheet opened from an unlinked token already knows its token.
  if (actor.isToken && actor.token) return actor.token;

  const onScene = canvas?.scene?.tokens?.find((t) => t.actorId === actor.id);
  return onScene ?? null;
}

/**
 * Context flags the document-control partial needs.
 * @param {Actor} actor
 */
export function documentControlContext(actor) {
  return {
    isToken: !!actor?.isToken,
    hasPlacedToken: !!placedTokenFor(actor),
    isGM: !!game.user?.isGM
  };
}
