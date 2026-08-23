import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { CROWS } from "../src/config.mjs";
import {
  earnedBonuses,
  earnedCharacteristicBonuses,
  grantedTotals,
  backgroundUses,
  validateAllocation,
  claimBonus,
  undoBonus,
  undoWouldStrand,
  characteristicCap,
  canRaiseCharacteristic,
  allCharacteristicsMaxed,
  raiseCharacteristic,
  undoCharacteristic,
  restOwed,
  unsettledTxp
} from "../src/system/advancement.mjs";

/** A sheet's worth of expertises, defaulting everything else to zero uses. */
const sheet = (overrides = {}) =>
  Object.fromEntries(
    Object.keys(CROWS.expertises).map((k) => [k, { uses: overrides[k] ?? 0, spent: 0 }])
  );

describe("Expertise & Stamina advancement (C p6)", () => {
  test("no bonus before the first threshold", () => {
    assert.equal(earnedBonuses(0).count, 0);
    assert.equal(earnedBonuses(99).count, 0);
    assert.equal(earnedBonuses(100).count, 1);
  });

  test("the printed table is followed exactly", () => {
    const expected = [
      [100, 1],
      [500, 2],
      [1250, 3],
      [2250, 4],
      [3500, 5],
      [5000, 6],
      [10000, 7],
      [20000, 8],
      [30000, 9]
    ];
    for (const [txp, count] of expected) {
      assert.equal(earnedBonuses(txp).count, count, `${txp} TXP should be bonus ${count}`);
    }
  });

  test("past the table, another bonus every 30,000 TXP", () => {
    assert.equal(earnedBonuses(59999).count, 9);
    assert.equal(earnedBonuses(60000).count, 10);
    assert.equal(earnedBonuses(90000).count, 11);
  });

  test("the per-expertise cap rises 2 -> 3 -> 4 and stops", () => {
    assert.equal(earnedBonuses(0).maxUses, 2, "a fresh crow's cap is not printed; 2 is the only consistent reading");
    assert.equal(earnedBonuses(3500).maxUses, 2);
    assert.equal(earnedBonuses(5000).maxUses, 3);
    assert.equal(earnedBonuses(10000).maxUses, 3);
    assert.equal(earnedBonuses(20000).maxUses, 4);
    assert.equal(earnedBonuses(1000000).maxUses, 4, "the ceiling is 4 forever");
  });

  test("characteristics are a SEPARATE table, and the two collide at 5,000 and 30,000", () => {
    assert.equal(earnedCharacteristicBonuses(4999), 0);
    assert.equal(earnedCharacteristicBonuses(5000), 1);
    assert.equal(earnedCharacteristicBonuses(15000), 2);
    assert.equal(earnedCharacteristicBonuses(30000), 3);

    // Both tables pay out at these two totals.
    for (const txp of [5000, 30000]) {
      assert.ok(earnedBonuses(txp).count > 0 && earnedCharacteristicBonuses(txp) > 0, `${txp} pays both`);
    }
  });
});

describe("the rest gate (C p6)", () => {
  test("XP earned since the last rest has not been slept on", () => {
    // The rule is about ORDER: the XP has to predate the rest.
    assert.equal(restOwed(1400, 1400), false, "rested at this exact total: nothing owed");
    assert.equal(restOwed(1600, 1400), true, "200 XP earned since the rest");
    assert.equal(unsettledTxp(1600, 1400), 200);
    assert.equal(unsettledTxp(1400, 1400), 0);
  });

  test("a crow who has never been marked is assumed caught up, not locked out", () => {
    // -1 is "the system started keeping this book today". Reporting a debt
    // would strip existing crows of bonuses they may already be playing with.
    assert.equal(restOwed(5000, -1), false);
    assert.equal(unsettledTxp(5000, -1), 0);
  });

  test("a mark ahead of current TXP never reports a negative debt", () => {
    // Can happen if a Ref lowers total XP after a rest.
    assert.equal(restOwed(1000, 1400), false);
    assert.equal(unsettledTxp(1000, 1400), 0);
  });

  test("the gate is about the mark, not about having any XP at all", () => {
    assert.equal(restOwed(0, 0), false);
    assert.equal(restOwed(1, 0), true, "the very first XP still needs a rest");
  });
});

describe("the characteristic cap is 4, not the field's bound of 5", () => {
  const chars = (a, m, s) => ({ agility: { value: a }, mind: { value: m }, strength: { value: s } });

  test("advancement stops at 4 even though the score field allows 5", () => {
    // Two different limits in two sentences. "Each characteristic has a score
    // between -5 and 5" bounds the FIELD; "the highest score a PC can have in a
    // characteristic without magic help is 4" (R p5) bounds ADVANCEMENT. Magic
    // may push a crow to 5; buying your way there may not.
    assert.equal(characteristicCap(), 4);
    assert.notEqual(characteristicCap(), CROWS.characteristicRange.max, "reading the field bound here is the bug");
    assert.equal(canRaiseCharacteristic(3), true);
    assert.equal(canRaiseCharacteristic(4), false);
  });

  test("raising a characteristic at the cap is refused, not silently clamped", () => {
    const result = raiseCharacteristic({ key: "agility", characteristics: chars(4, 1, 1) });
    assert.equal(result.update, null);
    assert.match(result.error, /already at 4/);
  });

  test("raising below the cap adds exactly one", () => {
    const result = raiseCharacteristic({ key: "mind", characteristics: chars(4, 1, 0) });
    assert.deepEqual(result.update, { "system.characteristics.mind.value": 2 });
    assert.equal(result.entry, "mind");
    assert.equal(result.overflowed, false);
  });

  test("a magically-boosted 5 does not make advancement think it can go further", () => {
    assert.equal(canRaiseCharacteristic(5), false);
    assert.equal(allCharacteristicsMaxed(chars(5, 4, 4)), true);
  });

  test("with every characteristic at 4 the bonus becomes +2 Stamina, automatically", () => {
    // The book offers no choice here, unlike the Expertise & Stamina bonus.
    assert.equal(allCharacteristicsMaxed(chars(4, 4, 4)), true);
    const result = raiseCharacteristic({
      key: "agility",
      characteristics: chars(4, 4, 4),
      staminaMax: 9,
      staminaValue: 6
    });
    assert.equal(result.overflowed, true);
    assert.equal(result.entry, "");
    assert.equal(result.update["system.stamina.max"], 11);
    assert.equal(result.update["system.stamina.value"], 8);
    assert.ok(!Object.keys(result.update).some((k) => k.includes("characteristics")));
  });

  test("one characteristic short of 4 is NOT the overflow case", () => {
    assert.equal(allCharacteristicsMaxed(chars(4, 4, 3)), false);
    const result = raiseCharacteristic({ key: "strength", characteristics: chars(4, 4, 3) });
    assert.equal(result.overflowed, false);
    assert.deepEqual(result.update, { "system.characteristics.strength.value": 4 });
  });

  test("undo reverses both branches", () => {
    assert.deepEqual(undoCharacteristic({ entry: "mind", characteristics: chars(1, 2, 1) }), {
      "system.characteristics.mind.value": 1
    });
    // An overflow bonus is recorded as "" and gives the Stamina back instead.
    assert.deepEqual(undoCharacteristic({ entry: "", staminaMax: 11, staminaValue: 11 }), {
      "system.stamina.max": 9,
      "system.stamina.value": 9
    });
  });

  test("undo never drives a score below the absolute floor", () => {
    const update = undoCharacteristic({ entry: "agility", characteristics: chars(-5, 0, 0) });
    assert.equal(update["system.characteristics.agility.value"], CROWS.characteristicRange.min);
  });

  test("an unknown characteristic is refused rather than creating one", () => {
    const result = raiseCharacteristic({ key: "charisma", characteristics: chars(1, 1, 1) });
    assert.equal(result.update, null);
    assert.match(result.error, /unknown characteristic/);
  });
});

describe("allocating a bonus's expertise uses", () => {
  const maxUses = 2;

  test("the three uses must be placed exactly, not merely not-exceeded", () => {
    // Under-placing silently loses a use, which is worse than a blocked dialog.
    const short = validateAllocation({
      option: "expertise",
      allocation: { stealth: 2 },
      expertises: sheet(),
      maxUses
    });
    assert.equal(short.ok, false);
    assert.match(short.errors.join(" "), /exactly 3/);

    const exact = validateAllocation({
      option: "expertise",
      allocation: { stealth: 2, thievery: 1 },
      expertises: sheet(),
      maxUses
    });
    assert.equal(exact.ok, true, exact.errors.join("; "));
  });

  test("over-placing is refused too", () => {
    const over = validateAllocation({
      option: "expertise",
      allocation: { stealth: 2, thievery: 2 },
      expertises: sheet(),
      maxUses
    });
    assert.equal(over.ok, false);
  });

  test("the cap counts uses ALREADY on the sheet, not just the ones being added", () => {
    // A crow with 1 use in Stealth can only take 1 more at a cap of 2.
    const bad = validateAllocation({
      option: "expertise",
      allocation: { stealth: 2, thievery: 1 },
      expertises: sheet({ stealth: 1 }),
      maxUses
    });
    assert.equal(bad.ok, false);
    assert.match(bad.errors.join(" "), /stealth would reach 3/i);
  });

  test("an expertise you have never trained is a legal target", () => {
    // "including expertises you don't already have" — this IS how you acquire one.
    const fresh = sheet();
    assert.equal(fresh.alchemy.uses, 0);
    const ok = validateAllocation({
      option: "expertise",
      allocation: { alchemy: 2, stealth: 1 },
      expertises: fresh,
      maxUses
    });
    assert.equal(ok.ok, true, ok.errors.join("; "));
  });

  test("the Stamina option accepts no expertise allocation at all", () => {
    assert.equal(validateAllocation({ option: "stamina", allocation: {}, expertises: sheet(), maxUses }).ok, true);
    const meddling = validateAllocation({
      option: "stamina",
      allocation: { stealth: 1 },
      expertises: sheet(),
      maxUses
    });
    assert.equal(meddling.ok, false);
  });

  test("the split option is one use, not three", () => {
    const three = validateAllocation({
      option: "split",
      allocation: { stealth: 1, thievery: 1, search: 1 },
      expertises: sheet(),
      maxUses
    });
    assert.equal(three.ok, false);

    const one = validateAllocation({ option: "split", allocation: { stealth: 1 }, expertises: sheet(), maxUses });
    assert.equal(one.ok, true, one.errors.join("; "));
  });

  test("a key that is not an expertise is rejected", () => {
    const bogus = validateAllocation({
      option: "expertise",
      allocation: { flying: 3 },
      expertises: sheet(),
      maxUses
    });
    assert.equal(bogus.ok, false);
    assert.match(bogus.errors.join(" "), /not an expertise/);
  });
});

describe("claiming and giving back", () => {
  test("claiming writes the uses and records where they went", () => {
    const expertises = sheet({ stealth: 1 });
    const { update, entry } = claimBonus({
      option: "expertise",
      allocation: { stealth: 1, thievery: 2 },
      expertises,
      staminaMax: 5,
      staminaValue: 5
    });
    assert.equal(update["system.expertises.stealth.uses"], 2);
    assert.equal(update["system.expertises.thievery.uses"], 2);
    assert.deepEqual(entry.uses, { stealth: 1, thievery: 2 });
    assert.equal(entry.stamina, 0);
    assert.equal(update["system.stamina.max"], undefined, "the expertise option touches no Stamina");
  });

  test("the Stamina option raises the maximum by 2 and lets you use it now", () => {
    const { update, entry } = claimBonus({
      option: "stamina",
      allocation: {},
      expertises: sheet(),
      staminaMax: 5,
      staminaValue: 5
    });
    assert.equal(update["system.stamina.max"], 7);
    assert.equal(update["system.stamina.value"], 7);
    assert.equal(entry.stamina, 2);
  });

  test("a raised maximum never pushes current Stamina above the new maximum", () => {
    const { update } = claimBonus({
      option: "split",
      allocation: { stealth: 1 },
      expertises: sheet(),
      staminaMax: 5,
      staminaValue: 2
    });
    assert.equal(update["system.stamina.max"], 6);
    assert.equal(update["system.stamina.value"], 3);
    assert.ok(update["system.stamina.value"] <= update["system.stamina.max"]);
  });

  test("giving a bonus back removes exactly what it granted", () => {
    const entry = { option: "split", uses: { stealth: 1 }, stamina: 1 };
    const update = undoBonus({
      entry,
      expertises: sheet({ stealth: 2 }),
      staminaMax: 6,
      staminaValue: 6
    });
    assert.equal(update["system.expertises.stealth.uses"], 1);
    assert.equal(update["system.stamina.max"], 5);
    assert.equal(update["system.stamina.value"], 5);
  });

  test("a bonus cannot be given back once its uses are gone", () => {
    // Otherwise `uses` drops below what the ledger granted, silently rewriting
    // the background's own uses — the one number nothing else records.
    const entry = { option: "expertise", uses: { stealth: 2, thievery: 1 }, stamina: 0 };
    assert.deepEqual(undoWouldStrand({ entry, expertises: sheet({ stealth: 2, thievery: 1 }) }), []);
    assert.deepEqual(undoWouldStrand({ entry, expertises: sheet({ stealth: 1, thievery: 1 }) }), ["stealth"]);
  });
});

describe("what the background gave, derived rather than stored", () => {
  test("uses the ledger does not account for came from the background", () => {
    const bonuses = [
      { option: "expertise", uses: { stealth: 2, thievery: 1 }, stamina: 0 },
      { option: "split", uses: { search: 1 }, stamina: 1 }
    ];
    const totals = grantedTotals(bonuses);
    assert.equal(totals.usesTotal, 4);
    assert.equal(totals.stamina, 1);

    // Thief starts with Stealth 2, Thievery 2, Search 2 from its background.
    const base = backgroundUses(sheet({ stealth: 4, thievery: 3, search: 3, athletics: 1 }), bonuses);
    assert.equal(base.stealth, 2);
    assert.equal(base.thievery, 2);
    assert.equal(base.search, 2);
    assert.equal(base.athletics, 1, "an expertise no bonus touched is all background");
    assert.equal(base.alchemy, 0);
  });

  test("an empty ledger means every use on the sheet is the background's", () => {
    const base = backgroundUses(sheet({ stealth: 2, gymnastics: 2 }), []);
    assert.equal(base.stealth, 2);
    assert.equal(base.gymnastics, 2);
  });
});
