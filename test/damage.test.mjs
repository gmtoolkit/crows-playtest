import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  applyDamage,
  applyCreatureDamage,
  chooseWoundSlots,
  speedPenalty,
  restRecovery,
  clearStarvation
, resolveDamageRecipients } from "../src/system/damage-math.mjs";

const clean = (n = 10) => Array(n).fill("");

describe("damage cascade: AD then Stamina then wounds (R p12)", () => {
  test("armor absorbs first", () => {
    const r = applyDamage({
      damage: 3,
      adSources: [{ id: "a", value: 5 }],
      stamina: 10,
      wounds: clean()
    });
    assert.deepEqual(r.adSpent, { a: 3 });
    assert.equal(r.staminaAfter, 10, "Stamina must be untouched while armor holds");
    assert.equal(r.woundsTaken, 0);
  });

  test("damage spills past armor into Stamina", () => {
    const r = applyDamage({
      damage: 8,
      adSources: [{ id: "a", value: 5 }],
      stamina: 10,
      wounds: clean()
    });
    assert.deepEqual(r.adSpent, { a: 5 });
    assert.equal(r.staminaAfter, 7, "3 should reach Stamina");
  });

  test("piercing damage skips armor entirely", () => {
    const r = applyDamage({
      damage: 4,
      piercing: true,
      adSources: [{ id: "a", value: 5 }],
      stamina: 10,
      wounds: clean()
    });
    assert.deepEqual(r.adSpent, {}, "piercing must not touch AD");
    assert.equal(r.staminaAfter, 6);
  });

  test("armor spends across multiple sources in the given order", () => {
    const r = applyDamage({
      damage: 7,
      adSources: [
        { id: "shield", value: 5 },
        { id: "suit", value: 4 }
      ],
      stamina: 10,
      wounds: clean()
    });
    assert.deepEqual(r.adSpent, { shield: 5, suit: 2 });
    assert.equal(r.staminaAfter, 10);
  });

  test("wounds begin only after BOTH armor and Stamina are spent", () => {
    // 5 AD + 3 Stamina absorbs 8; the 9th point is the first wound.
    const r = applyDamage({
      damage: 9,
      adSources: [{ id: "a", value: 5 }],
      stamina: 3,
      wounds: clean()
    });
    assert.equal(r.staminaAfter, 0);
    assert.equal(r.woundsTaken, 1, "exactly one point of overflow, so one wound");
  });

  test("damage that exactly empties Stamina causes no wound", () => {
    // Mutation guard: an off-by-one here would wound on a clean drop to zero.
    const r = applyDamage({ damage: 5, stamina: 5, wounds: clean() });
    assert.equal(r.staminaAfter, 0);
    assert.equal(r.woundsTaken, 0);
  });

  test("one wound per one damage", () => {
    const r = applyDamage({ damage: 4, stamina: 0, wounds: clean() });
    assert.equal(r.woundsTaken, 4);
  });

  test("filling every backpack slot with wounds is death", () => {
    const r = applyDamage({ damage: 10, stamina: 0, wounds: clean() });
    assert.equal(r.woundsTaken, 10);
    assert.equal(r.dead, true);
  });

  test("nine wounds is not death", () => {
    const r = applyDamage({ damage: 9, stamina: 0, wounds: clean() });
    assert.equal(r.dead, false, "death requires ALL slots wounded");
  });

  test("existing wounds count toward death", () => {
    const wounds = clean();
    for (let i = 0; i < 8; i++) wounds[i] = "normal";
    const r = applyDamage({ damage: 2, stamina: 0, wounds });
    assert.equal(r.dead, true);
  });

  test("damage beyond the last slot is reported as overflow", () => {
    const r = applyDamage({ damage: 15, stamina: 0, wounds: clean() });
    assert.equal(r.woundsTaken, 10);
    assert.equal(r.overflow, 5);
  });
});

describe("wound placement", () => {
  test("empty slots are wounded before loaded ones", () => {
    // A wound sharing a slot with cargo costs speed, so free slots go first.
    const occupied = new Set([0, 1, 2]);
    assert.deepEqual(chooseWoundSlots(clean(), occupied, 2), [3, 4]);
  });

  test("loaded slots are used once free ones run out", () => {
    const occupied = new Set([0, 1, 2, 3, 4, 5, 6, 7]);
    // Free slots are 8 and 9; the third wound must fall on a loaded slot.
    assert.deepEqual(chooseWoundSlots(clean(), occupied, 3), [8, 9, 0]);
  });

  test("already-wounded slots are never chosen twice", () => {
    const wounds = clean();
    wounds[0] = "normal";
    wounds[1] = "normal";
    assert.deepEqual(chooseWoundSlots(wounds, new Set(), 2), [2, 3]);
  });

  test("asking for more wounds than there are slots returns only what fits", () => {
    assert.equal(chooseWoundSlots(clean(), new Set(), 99).length, 10);
  });
});

describe("speed penalty from wounds (R p12)", () => {
  test("a wound on an empty slot is free under the strict reading", () => {
    const wounds = clean();
    wounds[5] = "normal";
    assert.equal(speedPenalty(wounds, new Set()), 0);
  });

  test("a wound sharing a slot with cargo costs 1", () => {
    const wounds = clean();
    wounds[5] = "normal";
    assert.equal(speedPenalty(wounds, new Set([5])), 1);
  });

  test("cargo alone costs nothing", () => {
    // The loose reading would charge for every packed slot, flooring a fresh
    // crow at speed 0 before taking a scratch.
    assert.equal(speedPenalty(clean(), new Set([0, 1, 2, 3, 4])), 0);
  });

  test("the loose reading is available and does charge for cargo alone", () => {
    assert.equal(speedPenalty(clean(), new Set([0, 1, 2]), "either"), 3);
  });

  test("the two readings genuinely differ", () => {
    const wounds = clean();
    wounds[0] = "normal";
    const occupied = new Set([1, 2]);
    assert.notEqual(speedPenalty(wounds, occupied, "both"), speedPenalty(wounds, occupied, "either"));
  });
});

describe("recovery", () => {
  test("a rest removes one ordinary wound", () => {
    const wounds = clean();
    wounds[0] = "normal";
    wounds[1] = "normal";
    const r = restRecovery(wounds);
    assert.equal(r.healed, 1);
    assert.equal(r.wounds.filter((w) => w === "normal").length, 1);
  });

  test("a rest does NOT remove starvation wounds", () => {
    const wounds = clean();
    wounds[0] = "starvation";
    wounds[1] = "starvation";
    const r = restRecovery(wounds);
    assert.equal(r.healed, 0, "starvation clears by eating, never by resting");
    assert.equal(r.wounds.filter((w) => w === "starvation").length, 2);
  });

  test("Tend Wounds removes two", () => {
    const wounds = clean();
    wounds[0] = wounds[1] = wounds[2] = "normal";
    assert.equal(restRecovery(wounds, { woundsHealed: 2 }).healed, 2);
  });

  test("eating clears every starvation wound at once", () => {
    const wounds = clean();
    wounds[0] = "starvation";
    wounds[3] = "starvation";
    wounds[5] = "normal";
    const r = clearStarvation(wounds);
    assert.equal(r.cleared, 2);
    assert.equal(r.wounds.filter((w) => w === "starvation").length, 0);
    assert.equal(r.wounds[5], "normal", "ordinary wounds must survive a meal");
  });
});

describe("creature damage (R p12)", () => {
  test("a monster dies at 0 Stamina and never takes wounds", () => {
    const r = applyCreatureDamage({ damage: 20, stamina: 15, usesWounds: false });
    assert.equal(r.staminaAfter, 0);
    assert.equal(r.dead, true);
    assert.equal(r.woundsAfter, 0);
  });

  test("a monster above 0 Stamina is alive", () => {
    const r = applyCreatureDamage({ damage: 5, stamina: 15, usesWounds: false });
    assert.equal(r.dead, false);
  });

  test("a human takes wounds past 0 Stamina", () => {
    const r = applyCreatureDamage({ damage: 8, stamina: 5, usesWounds: true, woundMax: 10 });
    assert.equal(r.staminaAfter, 0);
    assert.equal(r.woundsAfter, 3);
    assert.equal(r.dead, false);
  });

  test("a human dies when wounds reach the maximum", () => {
    const r = applyCreatureDamage({ damage: 12, stamina: 2, wounds: 0, woundMax: 10, usesWounds: true });
    assert.equal(r.woundsAfter, 10);
    assert.equal(r.dead, true);
  });

  test("creature armor absorbs before Stamina, and piercing skips it", () => {
    assert.equal(applyCreatureDamage({ damage: 4, ad: 5, stamina: 10 }).staminaAfter, 10);
    assert.equal(applyCreatureDamage({ damage: 4, ad: 5, stamina: 10, piercing: true }).staminaAfter, 6);
  });
});

describe("who takes the damage from a chat card", () => {
  const tok = (id, name) => ({ name, actor: { id } });

  test("a target beats a selection, which is the bug that hurt a player", () => {
    // Vess targeted a monster but still had her own token selected, and the
    // card read only the selection, so her axe crit landed on herself.
    const r = resolveDamageRecipients({
      targets: [tok("monster", "Undead C")],
      controlled: [tok("vess", "Vess Harrow")],
      sourceActorId: "vess"
    });
    assert.deepEqual(r.tokens.map((t) => t.name), ["Undead C"]);
    assert.equal(r.usedTargets, true);
    assert.equal(r.selfHit, false);
  });

  test("selection is used when nothing is targeted", () => {
    const r = resolveDamageRecipients({
      targets: [],
      controlled: [tok("monster", "Undead C")],
      sourceActorId: "vess"
    });
    assert.deepEqual(r.tokens.map((t) => t.name), ["Undead C"]);
    assert.equal(r.usedTargets, false);
  });

  test("nothing targeted and nothing selected is reported, not silently ignored", () => {
    const r = resolveDamageRecipients({ targets: [], controlled: [], sourceActorId: "vess" });
    assert.equal(r.empty, true);
    assert.equal(r.tokens.length, 0);
  });

  test("damaging only yourself is flagged, because it is legal but rarely meant", () => {
    const r = resolveDamageRecipients({
      targets: [tok("vess", "Vess Harrow")],
      controlled: [],
      sourceActorId: "vess"
    });
    assert.equal(r.selfHit, true, "a backlash or a trap is real; it just needs confirming");
  });

  test("a mixed group including yourself is NOT flagged as self-damage", () => {
    // A fireball catching you and two enemies is an ordinary outcome.
    const r = resolveDamageRecipients({
      targets: [tok("vess", "Vess"), tok("monster", "Undead C")],
      controlled: [],
      sourceActorId: "vess"
    });
    assert.equal(r.selfHit, false);
    assert.equal(r.tokens.length, 2);
  });

  test("multiple targets all take it", () => {
    const r = resolveDamageRecipients({
      targets: [tok("a", "A"), tok("b", "B"), tok("c", "C")],
      controlled: [tok("vess", "Vess")],
      sourceActorId: "vess"
    });
    assert.equal(r.tokens.length, 3);
    assert.equal(r.usedTargets, true);
  });

  test("with no source actor, nothing is ever called self-damage", () => {
    const r = resolveDamageRecipients({ targets: [tok("x", "X")], controlled: [], sourceActorId: null });
    assert.equal(r.selfHit, false);
  });
});
