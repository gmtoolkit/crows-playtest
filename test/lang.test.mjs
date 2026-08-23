import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
  "CROWS.Tabs"
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
