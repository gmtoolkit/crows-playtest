import { CROWS } from "../config.mjs";

/**
 * The situational edges and banes a roll might carry, and why.
 *
 * Crows funnels every circumstance into one currency: edges and banes. The
 * roll dialog already accepted the NUMBERS, but nothing told you where they
 * came from, so counting them was a job you did in your head and usually
 * skipped. This names each one, cites its page, and says whether the VTT is
 * sure about it.
 *
 * DETECTED IS NOT THE SAME AS APPLIED. Anything Foundry can measure — light
 * level, elevation, a status effect, a wall in the way — arrives ticked.
 * Anything that needs a Ref's judgement — is that fog "light" or "heavy"
 * concealment, does that barrel really cover half of you — is offered
 * UNTICKED with its rule attached. A system that quietly decided those would
 * be wrong often and invisibly, which is worse than counting by hand.
 *
 * Pure: takes facts, returns modifiers. No canvas, no globals.
 */

/**
 * Every situational modifier Crows defines for an attack or a perception test.
 *
 * `detectable` marks the ones a VTT can answer from its own state; the rest
 * are prompts for a human. `applies` is evaluated against the facts given.
 */
const MODIFIERS = [
  /* --- Lighting (R p16) ------------------------------------------------ */
  {
    key: "dimLight",
    kind: "bane",
    count: 1,
    page: "R p16",
    detectable: true,
    applies: (f) => f.targetLight === "dim"
  },
  {
    key: "darkness",
    kind: "bane",
    // "a double bane" — two banes, which shifts a tier rather than adding -4.
    count: 2,
    page: "R p16",
    detectable: true,
    applies: (f) => f.targetLight === "dark",
    note: "guessSquare"
  },

  /* --- Concealment (R p17) --------------------------------------------- */
  {
    key: "lightConcealment",
    kind: "bane",
    count: 1,
    page: "R p17",
    // Fog and rain are fiction the Ref places; nothing on a token says "foggy".
    detectable: false,
    applies: (f) => !!f.lightConcealment
  },
  {
    key: "heavyConcealment",
    kind: "bane",
    count: 2,
    page: "R p17",
    detectable: false,
    applies: (f) => !!f.heavyConcealment,
    note: "guessSquare"
  },
  {
    key: "invisible",
    kind: "bane",
    count: 2,
    page: "R p17",
    detectable: true,
    applies: (f) => !!f.targetInvisible,
    note: "guessSquare"
  },

  /* --- Position (R p16, p20) ------------------------------------------- */
  {
    key: "cover",
    kind: "bane",
    count: 1,
    page: "R p16",
    // A wall between the two is measurable; "half their form" is a judgement.
    detectable: true,
    applies: (f) => !!f.cover
  },
  {
    key: "highGround",
    kind: "edge",
    count: 1,
    page: "R p20",
    detectable: true,
    applies: (f) => (f.elevationDifference ?? 0) >= 1
  },
  {
    key: "flanking",
    kind: "edge",
    count: 1,
    page: "R p20",
    // The geometry is a corner-to-corner line test; offered rather than
    // guessed, because getting it wrong silently is worse than asking.
    detectable: false,
    applies: (f) => !!f.flanking
  },

  /* --- Target conditions (R p12) --------------------------------------- */
  {
    key: "targetProne",
    kind: "edge",
    count: 1,
    page: "R p12",
    detectable: true,
    // "melee attacks against you gain an edge, and ranged attacks take a bane"
    applies: (f) => f.targetProne && f.attackType === "melee"
  },
  {
    key: "targetProneRanged",
    kind: "bane",
    count: 1,
    page: "R p12",
    detectable: true,
    applies: (f) => f.targetProne && f.attackType === "ranged"
  },
  {
    key: "targetGrabbed",
    kind: "edge",
    count: 1,
    page: "R p12",
    detectable: true,
    applies: (f) => !!f.targetGrabbed
  },

  /* --- Attacker conditions (R p12) ------------------------------------- */
  {
    key: "weakened",
    kind: "bane",
    count: 1,
    page: "R p12",
    detectable: true,
    // "you take a bane on ALL tests", so this one is not attack-only.
    applies: (f) => !!f.selfWeakened
  },
  {
    key: "selfProne",
    kind: "bane",
    count: 1,
    page: "R p12",
    detectable: true,
    applies: (f) => f.selfProne && f.attackType === "melee"
  }
];

/**
 * Which modifiers apply, given what we know.
 *
 * Returns every one that COULD apply, each flagged `detected` (we measured it,
 * so it arrives ticked) or not (we are asking). Undetectable modifiers are
 * always returned so they can be offered, unless the caller says otherwise.
 *
 * @param {object} facts
 * @param {"melee"|"ranged"|"test"} [facts.attackType]
 * @param {"bright"|"dim"|"dark"} [facts.targetLight]
 * @param {number} [facts.elevationDifference]  Attacker elevation minus target's.
 * @param {boolean} [facts.cover] [facts.targetProne] [facts.targetGrabbed]
 * @param {boolean} [facts.targetInvisible] [facts.selfWeakened] [facts.selfProne]
 * @param {boolean} [facts.offerUndetectable=true]
 */
export function situationalModifiers(facts = {}) {
  const offer = facts.offerUndetectable !== false;

  return MODIFIERS.filter((m) => {
    if (m.detectable) return m.applies(facts);
    // Undetectable ones are offered whether or not the caller pre-set them,
    // because the whole point is to prompt for a judgement.
    return offer || m.applies(facts);
  }).map((m) => ({
    key: m.key,
    kind: m.kind,
    count: m.count,
    page: m.page,
    detected: !!m.detectable,
    active: m.detectable ? true : !!m.applies(facts),
    guessSquare: m.note === "guessSquare",
    label: `CROWS.Situation.${m.key}`,
    hint: `CROWS.SituationNote.${m.key}`
  }));
}

/**
 * Fold a set of chosen modifiers into edge and bane counts.
 *
 * They are COUNTS, not a sum: two banes is a tier shift rather than -4, and
 * `resolveEdgesAndBanes` cancels them against each other. Collapsing to a
 * single number here would lose exactly the distinction the rules turn on.
 */
export function totalsFrom(modifiers = []) {
  let edges = 0;
  let banes = 0;
  for (const m of modifiers) {
    if (!m.active) continue;
    if (m.kind === "edge") edges += m.count;
    else banes += m.count;
  }
  return { edges, banes };
}

/** Whether any active modifier forces the attacker to guess the target's square. */
export function mustGuessSquare(modifiers = []) {
  return modifiers.some((m) => m.active && m.guessSquare);
}

/**
 * Read the light level at a point, given the scene's lighting state.
 *
 * Kept pure and fed by the caller, so the band thresholds are testable without
 * a canvas. Crows names three levels and each carries a different penalty.
 */
export function lightLevelAt({ bright = false, dim = false, globalLight = false, darkness = 0 } = {}) {
  if (globalLight || bright) return "bright";
  if (dim) return "dim";
  return darkness > 0 ? "dark" : "bright";
}
