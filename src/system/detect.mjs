import { situationalModifiers, lightLevelAt } from "./situation.mjs";

/**
 * Gather what Foundry can actually observe about an attack.
 *
 * Everything here is measured, never inferred: a light level read from the
 * lighting layer, an elevation difference off two token documents, a status
 * effect that is genuinely present, a wall the collision backend says is in
 * the way. If a fact cannot be measured it is simply absent, and
 * `situationalModifiers` offers it as a question instead of guessing.
 *
 * Returns null when there is no target, because with nothing targeted there is
 * no situation to read and a dialog full of unticked boxes is worse than none.
 */
export function detectSituation({ actor, item = null } = {}) {
  const attacker = actor?.getActiveTokens?.()[0] ?? null;
  const targets = Array.from(game.user?.targets ?? []);
  const target = targets[0] ?? null;

  // Melee versus ranged changes which way a prone target cuts (R p12).
  const attackType = item?.system?.range?.type === "ranged" ? "ranged" : "melee";

  if (!target) {
    // No target: still offer the judgement calls and any condition on the
    // roller themselves, which apply to every test regardless.
    return {
      facts: { attackType, selfWeakened: hasStatus(attacker?.actor, "weakened"), selfProne: hasStatus(attacker?.actor, "prone") },
      modifiers: situationalModifiers({
        attackType,
        selfWeakened: hasStatus(attacker?.actor, "weakened"),
        selfProne: hasStatus(attacker?.actor, "prone")
      }),
      target: null,
      attacker: attacker?.name ?? null
    };
  }

  const facts = {
    attackType,
    targetLight: lightAtToken(target),
    elevationDifference: (attacker?.document?.elevation ?? 0) - (target.document?.elevation ?? 0),
    cover: attacker ? hasWallBetween(attacker, target) : false,
    targetProne: hasStatus(target.actor, "prone"),
    targetGrabbed: hasStatus(target.actor, "grabbed"),
    targetInvisible: hasStatus(target.actor, "invisible") || hasStatus(target.actor, "hidden"),
    selfWeakened: hasStatus(attacker?.actor, "weakened"),
    selfProne: hasStatus(attacker?.actor, "prone")
  };

  return {
    facts,
    modifiers: situationalModifiers(facts),
    target: target.name,
    attacker: attacker?.name ?? null
  };
}

/** Whether an actor carries a status, tolerating either id or name. */
function hasStatus(actor, id) {
  if (!actor) return false;
  return actor.statuses?.has?.(id) ?? false;
}

/**
 * The light level standing on a token's square.
 *
 * Read from the scene's own lighting rather than from the token, because a
 * token does not know what is shining on it — only the canvas does.
 */
function lightAtToken(token) {
  const scene = token.scene ?? canvas.scene;
  const darkness = scene?.environment?.darknessLevel ?? 0;
  const globalLight = !!scene?.environment?.globalLight?.enabled;

  // No darkness and no global override: the map is simply lit.
  if (!darkness) return "bright";

  const point = token.center;
  let bright = false;
  let dim = false;

  for (const src of canvas.effects?.lightSources ?? []) {
    if (!src.active) continue;
    const shape = src.shape;
    if (!shape?.contains?.(point.x, point.y)) continue;
    const d = Math.hypot(point.x - src.x, point.y - src.y);
    const grid = canvas.dimensions.distancePixels ?? canvas.dimensions.size;
    const brightPx = (src.data.bright ?? 0) * grid;
    if (d <= brightPx) bright = true;
    else dim = true;
  }

  return lightLevelAt({ bright, dim, globalLight, darkness });
}

/**
 * Is something solid between them?
 *
 * Uses the SIGHT backend rather than move: cover is about what can be seen
 * through, and a low wall that blocks movement but not vision gives no cover.
 * A full block means no line of effect at all, which the rules treat as
 * untargetable rather than as cover, so this is only ever a hint.
 */
function hasWallBetween(a, b) {
  try {
    return !!CONFIG.Canvas.polygonBackends.sight.testCollision(a.center, b.center, {
      type: "sight",
      mode: "any"
    });
  } catch {
    return false;
  }
}
