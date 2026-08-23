import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { splitTreasure, thresholdsCrossed, haulValue, qualifies } from "../src/system/treasure.mjs";

describe("recovering treasure is what earns XP (C p6)", () => {
  test("the haul divides by the number of players", () => {
    const split = splitTreasure(1200, 4);
    assert.equal(split.each, 300);
    assert.equal(split.remainder, 0);
  });

  test("the remainder is reported, never silently dropped or gifted", () => {
    // The book gives no rounding rule, so a leftover gc is a table
    // conversation rather than something the system decides.
    const split = splitTreasure(1000, 3);
    assert.equal(split.each, 333);
    assert.equal(split.remainder, 1);
    assert.equal(split.each * 3 + split.remainder, 1000);
  });

  test("a party of one keeps the lot", () => {
    assert.deepEqual(splitTreasure(500, 1), { each: 500, remainder: 0, partySize: 1, total: 500 });
  });

  test("a haul too small to split pays nobody, rather than paying zero silently", () => {
    const split = splitTreasure(3, 4);
    assert.equal(split.each, 0);
    assert.equal(split.remainder, 3);
  });

  test("nonsense input cannot produce a division by zero or a negative award", () => {
    assert.equal(splitTreasure(-50, 4).each, 0);
    assert.equal(splitTreasure(100, 0).each, 100, "party size floors at 1");
    assert.equal(splitTreasure(100, -3).each, 100);
  });
});

describe("what the haul is worth", () => {
  test("ordinary items count their gc cost times quantity", () => {
    const v = haulValue([
      { cost: 100, quantity: 2 },
      { cost: 50 }
    ]);
    assert.equal(v.gc, 250);
    assert.equal(v.uniqueXp, 0);
    assert.equal(v.total, 250);
  });

  test("unique items have no cost and carry a printed XP value instead", () => {
    // "Unique items don't have a cost. Their XP value is listed on their cards."
    const v = haulValue([{ unique: true, xpValue: 750 }, { cost: 100 }]);
    assert.equal(v.gc, 100);
    assert.equal(v.uniqueXp, 750);
    assert.equal(v.total, 850);
  });

  test("a unique item's absent cost does not quietly count as zero gc twice", () => {
    const v = haulValue([{ unique: true, xpValue: 500, cost: 999 }]);
    assert.equal(v.gc, 0, "a unique item's cost field is ignored, not added");
    assert.equal(v.total, 500);
  });
});

describe("the exclusions are provenance, not item data", () => {
  test("a clean haul qualifies", () => {
    assert.equal(qualifies({}), true);
  });

  test("any single exclusion disqualifies the whole haul", () => {
    for (const key of ["purchased", "crafted", "fromInnocent", "fromAlly", "insideVillage"]) {
      assert.equal(qualifies({ [key]: true }), false, `${key} should disqualify`);
    }
  });
});

describe("threshold crossings are per crow, because starting points differ", () => {
  test("an award that crosses a threshold reports it", () => {
    // 90 -> 190 crosses 100.
    const crossed = thresholdsCrossed(90, 190);
    assert.equal(crossed.bonuses, 1);
    assert.equal(crossed.any, true);
  });

  test("the same award crosses nothing for a crow already past it", () => {
    const crossed = thresholdsCrossed(600, 700);
    assert.equal(crossed.bonuses, 0);
    assert.equal(crossed.any, false);
  });

  test("one award can cross several thresholds at once", () => {
    // 0 -> 3500 passes 100, 500, 1250, 2250 and 3500.
    assert.equal(thresholdsCrossed(0, 3500).bonuses, 5);
  });

  test("5,000 pays out on BOTH tables", () => {
    const crossed = thresholdsCrossed(4900, 5000);
    assert.equal(crossed.bonuses, 1);
    assert.equal(crossed.characteristics, 1);
  });

  test("a rise in the per-expertise cap is reported separately", () => {
    // The cap goes 2 -> 3 at 5,000.
    const crossed = thresholdsCrossed(4900, 5000);
    assert.equal(crossed.maxUsesRose, true);
    assert.equal(crossed.newMaxUses, 3);

    const flat = thresholdsCrossed(600, 700);
    assert.equal(flat.maxUsesRose, false);
  });

  test("XP that crosses nothing is not reported as a level-up", () => {
    const crossed = thresholdsCrossed(1000, 1100);
    assert.equal(crossed.any, false);
    assert.equal(crossed.maxUsesRose, false);
  });
});
