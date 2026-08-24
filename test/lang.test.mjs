import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { CROWS } from "../src/config.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const lang = JSON.parse(readFileSync(join(root, "lang", "en.json"), "utf8"));

/**
 * Keys assembled at render time from a prefix plus a runtime value, e.g.
 * `{{localize (concat "CROWS.Tier" result.tier)}}`. The scanner sees only the
 * prefix, so these are checked as families instead of exact keys.
 */
const DYNAMIC_PREFIXES = [
  "CROWS.Tier",
  "CROWS.Activation",
  "CROWS.SlotError.",
  // ApplicationV2 `labelPrefix`: resolved as `${prefix}.${tabId}`.
  "CROWS.Tabs",
  // The catalogue builds its refusal key from the reason canTake() returned,
  // so each refusal can carry its own numbers. The family is checked below.
  "CROWS.CannotTake.",
  // Container names, resolved from a slot's own container key.
  "CROWS.Container.",
  // Advancement bonus packages, keyed by the option chosen.
  "CROWS.BonusOption.",
  // Treasure exclusions, keyed by the flag ticked.
  "CROWS.Exclusion."
];

function walk(dir, exts, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, exts, out);
    else if (exts.some((e) => entry.endsWith(e))) out.push(path);
  }
  return out;
}

/** Every quoted "CROWS.*" string across source and templates. */
function usedKeys() {
  const files = [...walk(join(root, "src"), [".mjs"]), ...walk(join(root, "templates"), [".hbs"])];
  const found = new Map();

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/["'](CROWS\.[A-Za-z0-9_.]+)["']/g)) {
      const key = match[1];
      if (!found.has(key)) found.set(key, []);
      found.get(key).push(file.replace(root, "").replace(/\\/g, "/"));
    }
  }
  return found;
}

describe("localisation coverage", () => {
  test("every referenced key is defined in en.json", () => {
    const missing = [];
    for (const [key, files] of usedKeys()) {
      if (key in lang) continue;
      // A dynamic prefix is satisfied if at least one key in its family exists.
      if (DYNAMIC_PREFIXES.some((p) => key === p || key.startsWith(p))) {
        const family = Object.keys(lang).filter((k) => k.startsWith(key));
        if (family.length) continue;
      }
      missing.push(`${key}  (${[...new Set(files)].join(", ")})`);
    }
    assert.deepEqual(missing, [], `Undefined localisation keys:\n  ${missing.join("\n  ")}`);
  });

  test("en.json is valid JSON with no empty values", () => {
    const empties = Object.entries(lang)
      .filter(([, v]) => typeof v !== "string")
      .map(([k]) => k);
    assert.deepEqual(empties, [], "all values must be strings");
  });

  test("every config label resolves", async () => {
    // config.mjs is Foundry-free, so it can be imported directly.
    const { CROWS } = await import("../src/config.mjs");

    const labels = [];
    const collect = (obj) => {
      for (const value of Object.values(obj ?? {})) {
        if (typeof value === "string" && value.startsWith("CROWS.")) labels.push(value);
        else if (value && typeof value === "object" && !Array.isArray(value)) collect(value);
      }
    };
    collect(CROWS);

    const missing = [...new Set(labels)].filter((k) => !(k in lang));
    assert.deepEqual(missing, [], `Config labels with no translation:\n  ${missing.join("\n  ")}`);
  });
});

/**
 * A dynamic prefix hides every key in its family from the coverage check, so
 * each family is pinned explicitly. Otherwise adding a refusal reason with no
 * string would render the raw key at the player, silently.
 */
describe("dynamic key families are complete", () => {
  const has = (k) => Object.prototype.hasOwnProperty.call(lang, k);

  test("every canTake() refusal reason has a message", () => {
    // These are the reasons src/system/acquisition.mjs can return.
    for (const reason of ["gmOnly", "tooExpensive", "noRoom", "notYours"]) {
      assert.ok(has(`CROWS.CannotTake.${reason}`), `missing CROWS.CannotTake.${reason}`);
    }
  });

  test("every container a slot can be has a name", () => {
    for (const c of ["hand", "belt", "backpack", "magic"]) {
      assert.ok(has(`CROWS.Container.${c}`), `missing CROWS.Container.${c}`);
    }
  });

  test("every advancement bonus package has a label", () => {
    for (const o of Object.keys(CROWS.expertiseBonusOptions)) {
      assert.ok(has(`CROWS.BonusOption.${o}`), `missing CROWS.BonusOption.${o}`);
    }
  });
});

/**
 * A key cannot be both a VALUE and a NAMESPACE.
 *
 * Foundry expands dotted keys into nested objects, so declaring both
 * "CROWS.Situation" (a string) and "CROWS.Situation.darkness" makes it try to
 * set a property on a string. That throws inside the loader and it does not
 * degrade gracefully: the ENTIRE language file is discarded, so every label in
 * the system renders as its raw key. It looks like the file failed to deploy.
 *
 * Cost when it happened: the whole sheet, every dialog and the turn HUD went
 * to raw keys, and the console error named one key out of 717.
 */
describe("no localization key is both a leaf and a namespace", () => {
  test("every key is either a value or a prefix, never both", () => {
    const keys = Object.keys(lang);
    const collisions = keys
      .filter((k) => keys.some((other) => other !== k && other.startsWith(`${k}.`)))
      .map((k) => {
        const children = keys.filter((o) => o !== k && o.startsWith(`${k}.`));
        return `"${k}" is a string but also the prefix of ${children.length} key(s), e.g. "${children[0]}"`;
      });

    assert.deepEqual(
      collisions,
      [],
      `Foundry discards the WHOLE file on this:\n  ${collisions.join("\n  ")}`
    );
  });
});
