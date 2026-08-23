import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseDamage, displayDamage } from "../src/dice/tiers.mjs";

describe("parsing printed damage (weapon and spell cards)", () => {
  test("a spelled-out characteristic becomes @mod", () => {
    assert.deepEqual(parseDamage("3 + S"), { formula: "3 + @mod", piercing: false, rider: false, note: "" });
  });

  test("an either-characteristic collapses to a single @mod", () => {
    // "2 + @mod or @mod" would double-count the modifier.
    assert.equal(parseDamage("2 + A or S").formula, "2 + @mod");
  });

  test("cards without spaces still parse", () => {
    assert.equal(parseDamage("4+M").formula, "4+@mod");
  });

  test("an already-normalised formula passes through", () => {
    assert.equal(parseDamage("6 + @mod").formula, "6 + @mod");
  });
});

describe("parsing creature stat-block damage", () => {
  test("the word 'dam' is stripped", () => {
    assert.equal(parseDamage("2 dam").formula, "2");
  });

  test("'damage' is stripped too", () => {
    assert.equal(parseDamage("3 damage").formula, "3");
  });

  test("a trailing asterisk flags a rider without breaking the number", () => {
    const r = parseDamage("8 dam*");
    assert.equal(r.formula, "8");
    assert.equal(r.rider, true);
  });

  test("dice formulas survive", () => {
    assert.equal(parseDamage("1d6 dam").formula, "1d6");
    assert.equal(parseDamage("2d10").formula, "2d10");
  });
});

describe("piercing detection", () => {
  test("a standalone capital P marks piercing", () => {
    const r = parseDamage("1d6 P dam");
    assert.equal(r.piercing, true);
    assert.equal(r.formula, "1d6");
  });

  test("piercing with a characteristic", () => {
    const r = parseDamage("2 P dam");
    assert.equal(r.piercing, true);
    assert.equal(r.formula, "2");
  });

  test("a lowercase p in a word is not piercing", () => {
    // "Push 1" must not be read as piercing damage.
    assert.equal(parseDamage("Push 1").piercing, false);
  });

  test("the P in 'Prone' is not piercing", () => {
    assert.equal(parseDamage("prone").piercing, false);
  });
});

describe("prose outcomes yield no damage", () => {
  test("'Push 1' is not damage", () => {
    assert.equal(parseDamage("Push 1").formula, null);
  });

  test("'The target can counter' is not damage", () => {
    assert.equal(parseDamage("The target can counter").formula, null);
  });

  test("'No effect' is not damage", () => {
    assert.equal(parseDamage("No effect").formula, null);
  });

  test("empty and null are safe", () => {
    assert.equal(parseDamage("").formula, null);
    assert.equal(parseDamage(null).formula, null);
    assert.equal(parseDamage(undefined).formula, null);
  });

  test("'The target is grabbed by you' is not damage", () => {
    assert.equal(parseDamage("The target is grabbed by you").formula, null);
  });
});

describe("trailing effect clauses", () => {
  test("a semicolon clause is kept as a note, not as formula", () => {
    const r = parseDamage("6 damage; weakened");
    assert.equal(r.formula, "6");
    assert.equal(r.note, "weakened");
  });

  test("a comma clause behaves the same", () => {
    const r = parseDamage("3 dam, prone");
    assert.equal(r.formula, "3");
    assert.equal(r.note, "prone");
  });

  test("a clause on a non-damage outcome still yields no formula", () => {
    assert.equal(parseDamage("Push 1; the target is prone").formula, null);
  });
});

describe("card-face damage display", () => {
  const actor = (mods) => ({ system: { characteristicMod: (which) => mods[which] ?? 0 } });

  test("resolves to a single number for the carrier", () => {
    assert.equal(displayDamage("3 + S", actor({ strength: 2 }), "strength"), "5");
  });

  test("an either-characteristic uses the better one", () => {
    const a = actor({ agility: 1, strength: 3 });
    // characteristicMod("agilityOrStrength") is what the model returns; here the
    // stub reflects the actor having already picked the higher.
    assert.equal(displayDamage("2 + A or S", { system: { characteristicMod: () => 3 } }, "agilityOrStrength"), "5");
    assert.ok(a);
  });

  test("a negative modifier subtracts", () => {
    assert.equal(displayDamage("3 + S", actor({ strength: -1 }), "strength"), "2");
  });

  test("dice stay as a formula rather than collapsing", () => {
    assert.equal(displayDamage("1d6 + S", actor({ strength: 2 }), "strength"), "1d6 + 2");
  });

  test("piercing is marked on the card", () => {
    assert.equal(displayDamage("2 P dam", actor({ strength: 0 }), "strength"), "2 P");
  });

  test("with no owner it never shows the @mod placeholder", () => {
    const out = displayDamage("3 + @mod", null, "strength");
    assert.ok(!out.includes("@mod"), `showed a placeholder: ${out}`);
  });

  test("prose passes through untouched", () => {
    assert.equal(displayDamage("Push 1", actor({ strength: 2 }), "strength"), "Push 1");
  });

  test("empty input is empty output", () => {
    assert.equal(displayDamage("", null, "strength"), "");
  });
});
