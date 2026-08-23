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

/**
 * Field names declared by one of the shared schema fragments in fields.mjs.
 *
 * Keys inside `cardFields()` are one indent level shallower than a model's own,
 * and some of them are built by a helper (`carried: carriedField()`) rather
 * than by `new fields.X` — matching only the latter would silently report the
 * helper-built fields as undeclared, which is the opposite of this file's job.
 */
function fragmentFields(fn) {
  const text = readFileSync(join(root, "src", "data", "fields.mjs"), "utf8");
  const start = text.indexOf(`export function ${fn}(`);
  const body = text.slice(start, text.indexOf("\n}", start));
  return [...body.matchAll(/^\s{4}(\w+):\s*(?:new fields\.|\w+\()/gm)].map((m) => m[1]);
}

/**
 * Field names a DataModel declares, read from its source rather than executed.
 *
 * The item models COMPOSE their schema — `...cardFields(), ...attackFields()`
 * — so reading only the model file reports every shared card field as
 * undeclared. The spreads are followed into fields.mjs instead.
 */
function declaredFields(modelFile) {
  const text = readFileSync(join(root, "src", "data", modelFile), "utf8");
  const body = text.slice(text.indexOf("defineSchema"));
  const own = [...body.matchAll(/^\s{6}(\w+):\s*new fields\./gm)].map((m) => m[1]);
  const spread = [...body.matchAll(/\.\.\.(\w+)\(\)/g)].flatMap((m) => fragmentFields(m[1]));
  return new Set([...own, ...spread]);
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

/* -------------------------------------------- */
/*  Inventory cards (tools/extract-items.mjs)   */
/* -------------------------------------------- */

/**
 * The card packs, and the model each one's documents are validated against.
 * Kept as a table so a new item pack cannot be added without a guard.
 */
const ITEM_PACKS = [
  { dir: "weapons", type: "weapon", model: "item-weapon.mjs" },
  { dir: "armor", type: "armor", model: "item-armor.mjs" },
  { dir: "gear", type: "gear", model: "item-gear.mjs" },
  { dir: "spellbooks", type: "spellbook", model: "item-spellbook.mjs" }
];

for (const pack of ITEM_PACKS) {
  const docs = read(pack.dir);

  describe(`extracted ${pack.dir}`, { skip: docs.length === 0 && `no ${pack.dir} extracted` }, () => {
    test("every field the extractor emits is DECLARED by the data model", () => {
      // The same silent failure as the backgrounds: an undeclared field is
      // dropped on import with no error, so a weapon can build clean, import
      // clean, and carry no damage at all.
      const declared = declaredFields(pack.model);
      const emitted = new Set();
      for (const d of docs) for (const k of Object.keys(d.system)) emitted.add(k);
      const undeclared = [...emitted].filter((k) => !declared.has(k));
      assert.deepEqual(undeclared, [], `these would be dropped on import: ${undeclared.join(", ")}`);
    });

    test("every document is the pack's own type and has a unique key", () => {
      const keys = new Set();
      for (const d of docs) {
        assert.equal(d.type, pack.type, `${d.name} is a ${d.type} in the ${pack.dir} pack`);
        assert.ok(d.name, "a document with no name cannot be found in a compendium");
        assert.ok(!keys.has(d.__key), `duplicate key ${d.__key}`);
        keys.add(d.__key);
      }
    });

    test("card numbers are sane", () => {
      for (const d of docs) {
        assert.ok(d.system.stack >= 1, `${d.name} stacks ${d.system.stack}`);
        assert.ok(d.system.slots >= 0, `${d.name} occupies ${d.system.slots} slots`);
        assert.ok(d.system.price >= 0, `${d.name} costs ${d.system.price}`);
        // A card prints one or the other, never both (C p6).
        assert.ok(!(d.system.price > 0 && d.system.xpValue), `${d.name} carries both a price and an XP value`);
      }
    });

    test("every crafting block names an expertise config knows", () => {
      const bad = [];
      for (const d of docs) {
        const key = d.system.crafting?.expertise;
        if (key && !CROWS.expertises[key]) bad.push(`${d.name}: ${key}`);
      }
      assert.deepEqual(bad, []);
    });

    test("every usage-dice pool is a legal pool", () => {
      for (const d of docs) {
        const ud = d.system.ud;
        if (!ud) continue;
        assert.ok(ud.max > 0, `${d.name} has a usage-dice block with no dice`);
        assert.ok(CROWS.udTriggers[ud.trigger], `${d.name}: unknown UD trigger ${ud.trigger}`);
        assert.ok(CROWS.udRestore[ud.restore], `${d.name}: unknown UD restore ${ud.restore}`);
      }
    });

    test("every magic slot resolves against config", () => {
      const bad = docs
        .filter((d) => d.system.magicSlot && !CROWS.magicSlots[d.system.magicSlot])
        .map((d) => `${d.name}: ${d.system.magicSlot}`);
      assert.deepEqual(bad, []);
    });
  });
}

const weapons = read("weapons");

describe("extracted weapons", { skip: weapons.length === 0 && "no weapons extracted" }, () => {
  test("every weapon belongs to a group and carries only known properties", () => {
    const bad = [];
    for (const w of weapons) {
      if (!CROWS.weaponGroups[w.system.group]) bad.push(`${w.name}: group ${w.system.group}`);
      for (const p of w.system.properties ?? []) {
        if (!CROWS.weaponProperties[p.key]) bad.push(`${w.name}: property ${p.key}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test("every weapon deals damage on both hit tiers", () => {
    // The failure this exists for: a weapon whose damage row was lost to a
    // split row or a spilled cell still builds, still imports, and rolls
    // nothing. Deduplication is supposed to keep the copy that has one.
    const silent = weapons.filter((w) => !w.system.tier2 || !w.system.tier3).map((w) => w.name);
    assert.deepEqual(silent, []);
  });

  test("tier damage is stored in the roller's notation", () => {
    // The cards print "3 + S" and "2 + A or S"; the model stores the
    // characteristic separately and the formula as "@mod" (see fields.mjs), so
    // a stray printed letter here means the pair has come apart.
    const bad = [];
    for (const w of weapons) {
      for (const tier of ["tier2", "tier3"]) {
        if (/(?<![\w@])[AMS](?![\w])/.test(w.system[tier])) bad.push(`${w.name}.${tier}: ${w.system[tier]}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test("every characteristic is one the attack profile allows", () => {
    const allowed = new Set([
      "agility",
      "mind",
      "strength",
      "agilityOrStrength",
      "agilityOrMind",
      "mindOrStrength",
      "none"
    ]);
    const bad = weapons.filter((w) => !allowed.has(w.system.characteristic)).map((w) => w.name);
    assert.deepEqual(bad, []);
  });

  test("a thrown weapon carries both of its ranges", () => {
    for (const w of weapons) {
      if (w.system.range?.type !== "both") continue;
      assert.ok(w.system.range.thrownValue > 0, `${w.name} prints a thrown range it did not keep`);
    }
  });
});

const armor = read("armor");

describe("extracted armor", { skip: armor.length === 0 && "no armor extracted" }, () => {
  test("every suit provides Armor Defense", () => {
    for (const a of armor) {
      assert.ok(a.system.ad?.max > 0, `${a.name} provides no AD`);
      assert.equal(a.system.ad.value, a.system.ad.max, `${a.name} ships already depleted`);
    }
  });

  test("every declared category resolves against config", () => {
    // extract-items.mjs reports rather than emits an unknown category, so a
    // category that IS present must be one config knows.
    const bad = armor
      .filter((a) => a.system.category && !CROWS.armorCategories[a.system.category])
      .map((a) => `${a.name}: ${a.system.category}`);
    assert.deepEqual(bad, []);
  });
});

const spellbooks = read("spellbooks");

describe("extracted spellbooks", { skip: spellbooks.length === 0 && "no spellbooks extracted" }, () => {
  test("every spell has a discipline, a rank and a casting time config knows", () => {
    const bad = [];
    for (const b of spellbooks) {
      if (!CROWS.disciplines[b.system.discipline]) bad.push(`${b.name}: discipline ${b.system.discipline}`);
      if (!CROWS.castingTimes[b.system.castingTime]) bad.push(`${b.name}: casting ${b.system.castingTime}`);
      if (!(b.system.rank >= 0 && b.system.rank <= 5)) bad.push(`${b.name}: rank ${b.system.rank}`);
    }
    assert.deepEqual(bad, []);
  });

  test("every duration and area type resolves against config", () => {
    const bad = [];
    for (const b of spellbooks) {
      const duration = b.system.duration?.type;
      if (duration && !CROWS.spellDurations[duration]) bad.push(`${b.name}: duration ${duration}`);
      const area = b.system.area?.type;
      if (area && !CROWS.areaTypes[area]) bad.push(`${b.name}: area ${area}`);
    }
    assert.deepEqual(bad, []);
  });

  test("an attack spell deals damage and a non-attack spell describes an outcome", () => {
    const bad = [];
    for (const b of spellbooks) {
      if (b.system.isAttack && !b.system.tier3) bad.push(`${b.name}: attack spell with no tier 3 damage`);
      if (!b.system.isAttack && b.system.tier2) bad.push(`${b.name}: non-attack spell carrying damage`);
    }
    assert.deepEqual(bad, []);
  });
});

describe("the card packs together", { skip: read("gear").length === 0 && "no cards extracted" }, () => {
  test("no name is claimed by two packs", () => {
    // Gear is the fallback bucket, so a mis-parsed weapon lands there under the
    // weapon's own name and the compendium ships the same card twice.
    const seen = new Map();
    const clashes = [];
    for (const pack of ITEM_PACKS) {
      for (const d of read(pack.dir)) {
        if (seen.has(d.name)) clashes.push(`${d.name}: ${seen.get(d.name)} and ${pack.dir}`);
        else seen.set(d.name, pack.dir);
      }
    }
    assert.deepEqual(clashes, []);
  });

  test("every document names where it came from", () => {
    const bad = [];
    for (const pack of ITEM_PACKS) {
      for (const d of read(pack.dir)) if (!d.system.source) bad.push(`${pack.dir}/${d.__key}`);
    }
    assert.deepEqual(bad, []);
  });
});
