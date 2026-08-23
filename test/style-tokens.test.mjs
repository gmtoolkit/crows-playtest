import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const css = readFileSync(join(root, "styles", "crows.css"), "utf8");

/**
 * A CSS custom property is one namespace shared by the stylesheet and every
 * script that writes to an element's inline style. Nothing warns you when the
 * two disagree: the property just holds the last thing written, and every rule
 * reading it silently computes to garbage.
 *
 * That is not hypothetical here. `_onRender` wrote a 0..1 wound ratio into
 * `--crows-blood`, which the palette already defines as #9d2222, and the wound
 * markers on the Slots tab — `.wound-box.wounded` — rendered TRANSPARENT from
 * the first wound onwards, along with the dead banner and the dungeon-turn bar.
 * Every one of them looked deliberate. The sheet did not throw, log, or hint.
 */

/** Every `--crows-*: value` declared in the stylesheet. */
function declaredTokens() {
  const out = new Map();
  for (const m of css.matchAll(/(--crows-[a-z0-9-]+)\s*:\s*([^;{}]+);/gi)) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

const COLOUR = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|transparent|currentcolor)/i;

/** Every `setProperty("--crows-…")` anywhere in the source. */
function scriptWrites() {
  const hits = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith(".mjs")) continue;
      const text = readFileSync(full, "utf8");
      for (const m of text.matchAll(/setProperty\(\s*["'`](--crows-[a-z0-9-]+)["'`]/gi)) {
        hits.push({ file: full.slice(root.length + 1).replace(/\\/g, "/"), token: m[1] });
      }
    }
  };
  walk(join(root, "src"));
  return hits;
}

describe("CSS custom properties are one namespace", () => {
  test("no script writes to a token the palette defines as a colour", () => {
    const declared = declaredTokens();
    const colours = new Set(
      [...declared].filter(([, value]) => COLOUR.test(value)).map(([name]) => name)
    );

    // The palette must actually have been found, or this test passes vacuously.
    assert.ok(colours.size >= 4, `expected several colour tokens, found ${colours.size}`);
    assert.ok(colours.has("--crows-blood"), "the palette should still define --crows-blood as a colour");

    const collisions = scriptWrites().filter((h) => colours.has(h.token));
    assert.deepEqual(
      collisions,
      [],
      `script writes collide with palette colours: ${collisions
        .map((c) => `${c.token} in ${c.file}`)
        .join(", ")}. Use a distinct token name, or a class.`
    );
  });

  test("the wound markers still paint with the palette colour", () => {
    // The rule that went blank. If someone re-points it at a token a script
    // writes, the test above starts guarding the wrong thing, so pin the rule.
    const rule = /\.wound-box\.wounded\s*\{[^}]*background:\s*var\(([^)]+)\)/.exec(css);
    assert.ok(rule, ".wound-box.wounded should paint its background from a token");
    const token = rule[1].split(",")[0].trim();
    const value = declaredTokens().get(token);
    assert.ok(value, `${token} should be declared in the stylesheet`);
    assert.match(value, COLOUR, `${token} should resolve to a colour, got "${value}"`);
  });

  test("no stylesheet rule reads a token that nothing declares", () => {
    const declared = declaredTokens();
    const missing = new Set();
    for (const m of css.matchAll(/var\(\s*(--crows-[a-z0-9-]+)\s*(,|\))/gi)) {
      // A var() WITH a fallback is fine even if undeclared; without one it is
      // a silent empty value.
      if (m[2] === ")" && !declared.has(m[1])) missing.add(m[1]);
    }
    assert.deepEqual([...missing], [], "these tokens are read with no declaration and no fallback");
  });
});
