import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  situationalModifiers,
  totalsFrom,
  mustGuessSquare,
  lightLevelAt
} from "../src/system/situation.mjs";

const keys = (mods) => mods.map((m) => m.key).sort();
const find = (mods, key) => mods.find((m) => m.key === key);

describe("what the map can measure arrives ticked", () => {
  test("dim light is one bane", () => {
    const m = find(situationalModifiers({ targetLight: "dim" }), "dimLight");
    assert.equal(m.kind, "bane");
    assert.equal(m.count, 1);
    assert.equal(m.detected, true);
    assert.equal(m.active, true, "measured facts arrive applied");
  });

  test("darkness is a DOUBLE bane, which is two banes and not minus four", () => {
    // Two banes shift a tier; -4 would be a different rule entirely.
    const m = find(situationalModifiers({ targetLight: "dark" }), "darkness");
    assert.equal(m.count, 2);
    assert.equal(m.guessSquare, true, "darkness also forces a guess (R p16)");
  });

  test("bright light offers no lighting modifier at all", () => {
    const mods = situationalModifiers({ targetLight: "bright" });
    assert.equal(find(mods, "dimLight"), undefined);
    assert.equal(find(mods, "darkness"), undefined);
  });

  test("high ground needs a full square, not any difference", () => {
    assert.equal(find(situationalModifiers({ elevationDifference: 0 }), "highGround"), undefined);
    assert.ok(find(situationalModifiers({ elevationDifference: 1 }), "highGround"));
    assert.ok(find(situationalModifiers({ elevationDifference: 5 }), "highGround"));
    // Being BELOW gives nothing; the rule is one-directional.
    assert.equal(find(situationalModifiers({ elevationDifference: -3 }), "highGround"), undefined);
  });
});

describe("a prone target cuts both ways (R p12)", () => {
  test("melee against prone gains an edge", () => {
    const mods = situationalModifiers({ targetProne: true, attackType: "melee" });
    assert.equal(find(mods, "targetProne").kind, "edge");
    assert.equal(find(mods, "targetProneRanged"), undefined);
  });

  test("ranged against prone takes a bane", () => {
    const mods = situationalModifiers({ targetProne: true, attackType: "ranged" });
    assert.equal(find(mods, "targetProneRanged").kind, "bane");
    assert.equal(find(mods, "targetProne"), undefined, "the melee edge must not also apply");
  });

  test("your OWN prone condition banes only your melee", () => {
    assert.ok(find(situationalModifiers({ selfProne: true, attackType: "melee" }), "selfProne"));
    assert.equal(find(situationalModifiers({ selfProne: true, attackType: "ranged" }), "selfProne"), undefined);
  });
});

describe("judgement calls are offered, never decided", () => {
  test("concealment and flanking appear unticked with nothing detected", () => {
    const mods = situationalModifiers({});
    for (const key of ["lightConcealment", "heavyConcealment", "flanking"]) {
      const m = find(mods, key);
      assert.ok(m, `${key} should be offered`);
      assert.equal(m.detected, false, `${key} is not something a VTT can measure`);
      assert.equal(m.active, false, `${key} must not arrive pre-applied`);
    }
  });

  test("they can be turned off entirely for a caller that does not want prompts", () => {
    const mods = situationalModifiers({ offerUndetectable: false });
    assert.equal(find(mods, "flanking"), undefined);
  });

  test("a judgement call the caller already set stays active even when not offered", () => {
    const mods = situationalModifiers({ offerUndetectable: false, heavyConcealment: true });
    assert.equal(find(mods, "heavyConcealment").active, true);
  });
});

describe("folding the ticks into counts", () => {
  test("edges and banes stay SEPARATE counts", () => {
    // Collapsing to a net number would lose the double-edge/double-bane rule,
    // which is a tier shift rather than arithmetic.
    const mods = [
      { kind: "edge", count: 1, active: true },
      { kind: "bane", count: 2, active: true }
    ];
    assert.deepEqual(totalsFrom(mods), { edges: 1, banes: 2 });
  });

  test("unticked modifiers contribute nothing", () => {
    const mods = [
      { kind: "edge", count: 1, active: false },
      { kind: "bane", count: 1, active: true }
    ];
    assert.deepEqual(totalsFrom(mods), { edges: 0, banes: 1 });
  });

  test("an empty situation is zero, not undefined", () => {
    assert.deepEqual(totalsFrom([]), { edges: 0, banes: 0 });
    assert.deepEqual(totalsFrom(), { edges: 0, banes: 0 });
  });

  test("guess-the-square is reported only when such a modifier is active", () => {
    assert.equal(mustGuessSquare([{ active: true, guessSquare: true }]), true);
    assert.equal(mustGuessSquare([{ active: false, guessSquare: true }]), false);
    assert.equal(mustGuessSquare([{ active: true, guessSquare: false }]), false);
  });
});

describe("reading a light level", () => {
  test("global illumination beats everything", () => {
    assert.equal(lightLevelAt({ globalLight: true, darkness: 1 }), "bright");
  });

  test("an unlit scene is bright, not dark", () => {
    // Darkness 0 means the map is simply lit; there is no torch economy to run.
    assert.equal(lightLevelAt({ darkness: 0 }), "bright");
  });

  test("in a dark scene, no light source means darkness", () => {
    assert.equal(lightLevelAt({ darkness: 1 }), "dark");
  });

  test("bright beats dim when a token stands in both", () => {
    assert.equal(lightLevelAt({ bright: true, dim: true, darkness: 1 }), "bright");
  });

  test("dim alone is dim", () => {
    assert.equal(lightLevelAt({ dim: true, darkness: 1 }), "dim");
  });
});
