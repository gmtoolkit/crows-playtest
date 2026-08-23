import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { CROWS } from "../src/config.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(root, "packs-src");

/**
 * Guards over the extracted compendium sources.
 *
 * The failure these exist for is SILENT. A Foundry TypeDataModel drops any
 * field its schema does not declare, with no error and no warning: the pack
 * builds clean, the compendium imports clean, and the data is simply not
 * there. `traitTree` and `traitName` were emitted by the backgrounds extractor
 * and undeclared by the model, so the builder would have had nothing to place
 * a starting trait against and nothing would have said why.
 *
 * So: every key an extractor emits is checked against the model that receives
 * it, and every foreign key is checked against what it points at.
 */

const read = (dir) =>
  existsSync(join(SRC, dir))
    ? readdirSync(join(SRC, dir))
        .filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(readFileSync(join(SRC, dir, f), "utf8")))
    : [];

/** Field names a DataModel declares, read from its source rather than executed. */
function declaredFields(modelFile) {
  const text = readFileSync(join(root, "src", "data", modelFile), "utf8");
  const body = text.slice(text.indexOf("defineSchema"));
  return new Set([...body.matchAll(/^\s{6}(\w+):\s*new fields\./gm)].map((m) => m[1]));
}

const backgrounds = read("backgrounds");
const traits = read("traits");

describe("extracted backgrounds", { skip: backgrounds.length === 0 && "no backgrounds extracted" }, () => {
  test("all 36 are present and the 2d6 table is fully covered", () => {
    assert.equal(backgrounds.length, 36);
    const cells = new Set(backgrounds.map((b) => `${b.system.roll.first}${b.system.roll.second}`));
    assert.equal(cells.size, 36, "every background needs its own cell");
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        assert.ok(cells.has(`${a}${b}`), `roll ${a}${b} has no background`);
      }
    }
  });

  test("every field the extractor emits is DECLARED by the data model", () => {
    // The whole point: an undeclared field vanishes on import in silence.
    const declared = declaredFields("item-background.mjs");
    const emitted = new Set();
    for (const b of backgrounds) for (const k of Object.keys(b.system)) emitted.add(k);
    const undeclared = [...emitted].filter((k) => !declared.has(k));
    assert.deepEqual(
      undeclared,
      [],
      `these would be dropped on import with no error: ${undeclared.join(", ")}`
    );
  });

  test("every key resolves against config", () => {
    const bad = [];
    for (const b of backgrounds) {
      for (const e of b.system.expertises) if (!CROWS.expertises[e.key]) bad.push(`${b.name}: ${e.key}`);
      for (const c of b.system.characteristicAt2) if (!CROWS.characteristics[c]) bad.push(`${b.name}: ${c}`);
      if (b.system.traitTree && !CROWS.traitTrees[b.system.traitTree]) bad.push(`${b.name}: ${b.system.traitTree}`);
    }
    assert.deepEqual(bad, []);
  });

  test("starting expertise uses stay inside the printed 3 to 9", () => {
    for (const b of backgrounds) {
      const total = b.system.expertises.reduce((a, e) => a + e.uses, 0);
      assert.ok(total >= 3 && total <= 9, `${b.name} grants ${total} uses`);
    }
  });

  test("no background exceeds the starting per-expertise cap", () => {
    // The book's first advancement row caps an expertise at 2, and no printed
    // background breaks it. One that did would be unrepresentable on the sheet.
    for (const b of backgrounds) {
      for (const e of b.system.expertises) {
        assert.ok(
          e.uses <= CROWS.creation.startingMaxUses,
          `${b.name} grants ${e.uses} uses in ${e.key}, over the starting cap`
        );
      }
    }
  });

  test(
    "every granted starting trait exists as a trait document",
    { skip: traits.length === 0 && "no traits extracted" },
    () => {
      const keys = new Set(traits.map((t) => t.__key));
      const slug = (s) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
      const missing = [];
      for (const b of backgrounds) {
        if (!b.system.traitTree || !b.system.traitName) continue;
        const key = `${b.system.traitTree}-${slug(b.system.traitName)}`;
        if (!keys.has(key)) missing.push(`${b.name} -> ${key}`);
      }
      assert.deepEqual(missing, [], "a background granting a trait that does not exist cannot be built");
    }
  );

  test("starting traits are actually STARTING traits", () => {
    // A background granting a mid-tree trait would hand out a purchase the
    // crow has not opened the path to.
    if (!traits.length) return;
    const byKey = new Map(traits.map((t) => [t.__key, t]));
    const slug = (s) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
    const notStarting = [];
    for (const b of backgrounds) {
      if (!b.system.traitTree || !b.system.traitName) continue;
      const t = byKey.get(`${b.system.traitTree}-${slug(b.system.traitName)}`);
      if (t && !t.system.starting) notStarting.push(`${b.name} -> ${t.name}`);
    }
    assert.deepEqual(notStarting, []);
  });
});

describe("extracted traits", { skip: traits.length === 0 && "no traits extracted" }, () => {
  test("every field the extractor emits is declared by the data model", () => {
    const declared = declaredFields("item-trait.mjs");
    const emitted = new Set();
    for (const t of traits) for (const k of Object.keys(t.system)) emitted.add(k);
    const undeclared = [...emitted].filter((k) => !declared.has(k));
    assert.deepEqual(undeclared, [], `these would be dropped on import: ${undeclared.join(", ")}`);
  });

  test("every trait belongs to a tree config knows", () => {
    const bad = traits.filter((t) => !CROWS.traitTrees[t.system.tree]).map((t) => `${t.name}: ${t.system.tree}`);
    assert.deepEqual(bad, []);
  });
});
