import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  resolveEdgesAndBanes,
  tierForTotal,
  readSpecial,
  resolvePowerRoll,
  applyExpertise,
  resolveCraftingRoll,
  resolveUsageDice,
  resolveEncounterCheck
} from "../src/dice/tiers.mjs";

/**
 * Build a 2d10 face pair summing to `n`.
 *
 * Crit and doom depend only on the SUM (>= 19 / <= 3), so any pair reaching a
 * given sum is equally neutral — the guard below asserts the caller asked for a
 * sum that is neither, rather than trying to pick special faces.
 */
function neutralDice(n) {
  if (n <= 3 || n >= 19) throw new Error(`sum ${n} is itself a doom or crit; pick another`);
  for (let a = 1; a <= 10; a++) {
    const b = n - a;
    if (b >= 1 && b <= 10) return [a, b];
  }
  throw new Error(`no 2d10 pair sums to ${n}`);
}

describe("tier boundaries (R p6-7)", () => {
  test("11 and below is tier 1", () => {
    assert.equal(tierForTotal(11), 1);
    assert.equal(tierForTotal(-4), 1);
  });

  test("12 through 16 is tier 2", () => {
    assert.equal(tierForTotal(12), 2);
    assert.equal(tierForTotal(16), 2);
  });

  test("17 and above is tier 3", () => {
    assert.equal(tierForTotal(17), 3);
    assert.equal(tierForTotal(40), 3);
  });

  test("the boundaries are exactly 12 and 17, not 11 and 16", () => {
    // Mutation guard: an off-by-one in either threshold flips one of these.
    assert.notEqual(tierForTotal(11), tierForTotal(12));
    assert.notEqual(tierForTotal(16), tierForTotal(17));
  });
});

describe("edges and banes cancellation (R p8)", () => {
  test("a single edge is +2 with no tier shift", () => {
    assert.deepEqual(resolveEdgesAndBanes(1, 0), { net: 1, modifier: 2, tierShift: 0 });
  });

  test("a single bane is -2 with no tier shift", () => {
    assert.deepEqual(resolveEdgesAndBanes(0, 1), { net: -1, modifier: -2, tierShift: 0 });
  });

  test("a double edge shifts a tier and adds nothing", () => {
    assert.deepEqual(resolveEdgesAndBanes(2, 0), { net: 2, modifier: 0, tierShift: 1 });
  });

  test("a double bane worsens a tier and subtracts nothing", () => {
    assert.deepEqual(resolveEdgesAndBanes(0, 2), { net: -2, modifier: 0, tierShift: -1 });
  });

  test("an edge and a bane cancel", () => {
    assert.deepEqual(resolveEdgesAndBanes(1, 1), { net: 0, modifier: 0, tierShift: 0 });
  });

  test("a double edge and a double bane cancel", () => {
    assert.deepEqual(resolveEdgesAndBanes(2, 2), { net: 0, modifier: 0, tierShift: 0 });
  });

  test("a double edge with one bane leaves exactly one edge", () => {
    assert.deepEqual(resolveEdgesAndBanes(2, 1), { net: 1, modifier: 2, tierShift: 0 });
  });

  test("a double bane with one edge leaves exactly one bane", () => {
    assert.deepEqual(resolveEdgesAndBanes(1, 2), { net: -1, modifier: -2, tierShift: 0 });
  });

  test("extra edges beyond two do not stack further", () => {
    // "regardless of how many individual edges contribute to the double edge"
    assert.deepEqual(resolveEdgesAndBanes(5, 1), resolveEdgesAndBanes(2, 1));
    assert.deepEqual(resolveEdgesAndBanes(9, 0), resolveEdgesAndBanes(2, 0));
  });
});

describe("crits and dooms read the raw dice (R p7)", () => {
  test("19 and 20 are crits", () => {
    assert.equal(readSpecial([9, 10]).crit, true);
    assert.equal(readSpecial([10, 10]).crit, true);
  });

  test("18 is not a crit", () => {
    assert.equal(readSpecial([9, 9]).crit, false);
  });

  test("2 and 3 are dooms", () => {
    assert.equal(readSpecial([1, 1]).doom, true);
    assert.equal(readSpecial([1, 2]).doom, true);
  });

  test("4 is not a doom", () => {
    assert.equal(readSpecial([2, 2]).doom, false);
  });

  test("a crit beats a double bane", () => {
    // Raw 19 with a double bane would otherwise drop to tier 2.
    const r = resolvePowerRoll({ dice: [9, 10], mod: 0, banes: 2 });
    assert.equal(r.crit, true);
    assert.equal(r.tier, 3, "crit must force tier 3 regardless of banes");
  });

  test("a crit beats a large flat penalty", () => {
    const r = resolvePowerRoll({ dice: [10, 10], mod: -5, bonus: -10 });
    assert.equal(r.tier, 3);
  });

  test("a doom beats a double edge", () => {
    const r = resolvePowerRoll({ dice: [1, 1], mod: 5, edges: 2 });
    assert.equal(r.doom, true);
    assert.equal(r.tier, 1, "doom must force tier 1 regardless of edges");
  });

  test("a doom beats a huge bonus", () => {
    const r = resolvePowerRoll({ dice: [1, 2], mod: 5, bonus: 20 });
    assert.equal(r.tier, 1);
  });

  test("a roll cannot be both crit and doom", () => {
    for (let a = 1; a <= 10; a++) {
      for (let b = 1; b <= 10; b++) {
        const s = readSpecial([a, b]);
        assert.ok(!(s.crit && s.doom), `dice ${a},${b} claimed both`);
      }
    }
  });
});

describe("power roll composition", () => {
  test("the characteristic modifier moves the tier", () => {
    // Raw 11 is tier 1; +1 Agility makes it 12, which is tier 2.
    assert.equal(resolvePowerRoll({ dice: neutralDice(11), mod: 0 }).tier, 1);
    assert.equal(resolvePowerRoll({ dice: neutralDice(11), mod: 1 }).tier, 2);
  });

  test("a single edge is a numeric +2, not a tier shift", () => {
    // Raw 10 + edge = 12 = tier 2. If an edge were wrongly a tier shift, a raw
    // 10 (tier 1) would also become tier 2 — so this case cannot distinguish.
    // Raw 5 can: +2 is still tier 1, but a tier shift would make it tier 2.
    const r = resolvePowerRoll({ dice: neutralDice(5), edges: 1 });
    assert.equal(r.total, 7);
    assert.equal(r.tier, 1, "an edge must not shift tiers");
  });

  test("a double edge is a tier shift, not a numeric bonus", () => {
    // Raw 5 with a double edge: total stays 5, but the tier improves to 2.
    const r = resolvePowerRoll({ dice: neutralDice(5), edges: 2 });
    assert.equal(r.total, 5, "a double edge must add no number");
    assert.equal(r.tier, 2);
  });

  test("a double bane cannot push below tier 1", () => {
    const r = resolvePowerRoll({ dice: neutralDice(5), banes: 2 });
    assert.equal(r.tier, 1);
  });

  test("a double edge cannot push above tier 3", () => {
    const r = resolvePowerRoll({ dice: neutralDice(18), edges: 2 });
    assert.equal(r.tier, 3);
  });
});

describe("expertise (R p8)", () => {
  test("improves the result by one tier", () => {
    const r = resolvePowerRoll({ dice: neutralDice(13) });
    assert.equal(r.tier, 2);
    assert.equal(applyExpertise(r).tier, 3);
  });

  test("cannot exceed tier 3", () => {
    const r = resolvePowerRoll({ dice: neutralDice(18) });
    assert.equal(r.canApplyExpertise, false);
    assert.equal(applyExpertise(r).tier, 3);
  });

  test("cannot rescue a doom", () => {
    const r = resolvePowerRoll({ dice: [1, 1] });
    assert.equal(r.canApplyExpertise, false, "a doom is immune to expertises");
    assert.equal(applyExpertise(r).tier, 1);
  });

  test("does not mutate the original result", () => {
    const r = resolvePowerRoll({ dice: neutralDice(13) });
    applyExpertise(r);
    assert.equal(r.tier, 2, "applyExpertise must be pure");
  });
});

describe("crafting rolls (R p36)", () => {
  test("the total becomes points", () => {
    const r = resolveCraftingRoll({ dice: neutralDice(14), mod: 2 });
    assert.equal(r.points, 16);
  });

  test("a bad roll still accrues at least 1 point", () => {
    const r = resolveCraftingRoll({ dice: neutralDice(5), mod: -5, bonus: -10 });
    assert.ok(r.total < 1);
    assert.equal(r.points, 1);
  });

  test("a doom accrues nothing", () => {
    const r = resolveCraftingRoll({ dice: [1, 1], mod: 5 });
    assert.equal(r.doom, true);
    assert.equal(r.points, 0, "a doom must not fall back to the minimum of 1");
  });

  test("a double edge is a flat +4 here, not a tier shift", () => {
    const plain = resolveCraftingRoll({ dice: neutralDice(12) });
    const edged = resolveCraftingRoll({ dice: neutralDice(12), edges: 2 });
    assert.equal(edged.points - plain.points, 4);
  });

  test("a double bane is a flat -4", () => {
    const plain = resolveCraftingRoll({ dice: neutralDice(12) });
    const baned = resolveCraftingRoll({ dice: neutralDice(12), banes: 2 });
    assert.equal(plain.points - baned.points, 4);
  });

  test("each applied expertise is +4, capped at two", () => {
    const base = resolveCraftingRoll({ dice: neutralDice(12) }).points;
    assert.equal(resolveCraftingRoll({ dice: neutralDice(12), expertises: 1 }).points - base, 4);
    assert.equal(resolveCraftingRoll({ dice: neutralDice(12), expertises: 2 }).points - base, 8);
    assert.equal(
      resolveCraftingRoll({ dice: neutralDice(12), expertises: 5 }).points - base,
      8,
      "no more than two expertises may apply"
    );
  });
});

describe("usage dice (R p13)", () => {
  test("1s and 2s are spent, everything else survives", () => {
    assert.deepEqual(resolveUsageDice([1, 2, 3, 4], 4), { spent: 2, remaining: 2, exhausted: false });
  });

  test("3 is not spent", () => {
    // Mutation guard: widening the spend range to 1-3 breaks this.
    assert.equal(resolveUsageDice([3], 1).spent, 0);
  });

  test("an all-low pool empties", () => {
    assert.deepEqual(resolveUsageDice([1, 1], 2), { spent: 2, remaining: 0, exhausted: true });
  });

  test("cannot go below zero", () => {
    assert.equal(resolveUsageDice([1, 1, 1], 2).remaining, 0);
  });
});

describe("encounter checks (R p14)", () => {
  test("an encounter occurs at or above the encounter number", () => {
    assert.equal(resolveEncounterCheck(9, 9).occurs, true);
    assert.equal(resolveEncounterCheck(10, 9).occurs, true);
  });

  test("below the encounter number is safe", () => {
    assert.equal(resolveEncounterCheck(8, 9).occurs, false);
  });

  test("a HIGHER encounter number is SAFER", () => {
    // The single easiest rule in this system to implement backwards. Seclude
    // Camp and Scout for Danger both RAISE the EN to make the party safer.
    const roll = 9;
    assert.equal(resolveEncounterCheck(roll, 9).occurs, true, "EN 9: a 9 triggers");
    assert.equal(resolveEncounterCheck(roll, 10).occurs, false, "EN 10: the same 9 is now safe");
  });

  test("a 10 lands immediately; a lower hit only warns first", () => {
    assert.deepEqual(resolveEncounterCheck(10, 9), { occurs: true, immediate: true, warning: false });
    assert.deepEqual(resolveEncounterCheck(9, 9), { occurs: true, immediate: false, warning: true });
  });

  test("a miss is neither immediate nor a warning", () => {
    assert.deepEqual(resolveEncounterCheck(3, 9), { occurs: false, immediate: false, warning: false });
  });
});
