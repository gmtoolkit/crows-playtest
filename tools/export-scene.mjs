/**
 * Pull hand-authored scene work back out of a live world and into the module
 * source, so walls, doors, lights and ambient sounds ship with the adventure.
 *
 *   node tools/export-scene.mjs --world crows
 *   node tools/export-scene.mjs --world crows --scene "Blood Library"
 *
 * The workflow this serves: draw walls and place lights in Foundry (which is
 * the only sane way to do it), then run this to make that work reproducible
 * and shippable rather than trapped in one person's world.
 *
 * Foundry must be on the setup screen — it holds an exclusive lock on the
 * world's LevelDB while a world is open.
 */
import { ClassicLevel } from "classic-level";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PACKAGES } from "./packages.mjs";

const adventure = PACKAGES.adventure;
const SRC_DIR = join(adventure.root, "packs-src", "scenes");

const args = process.argv.slice(2);
const argOf = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const worldId = argOf("--world", "crows");
const onlyScene = argOf("--scene", null);

const worldDir = join(
  process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
  "FoundryVTT",
  "Data",
  "worlds",
  worldId
);
const scenesDb = join(worldDir, "data", "scenes");

if (!existsSync(scenesDb)) {
  console.error(`No scenes database at:\n  ${scenesDb}\nIs --world "${worldId}" right?`);
  process.exit(1);
}

/**
 * Placeable collections worth shipping.
 *
 * `notes` is deliberately absent: a note points at a journal entry id, and
 * those journals are not in the module yet, so exporting them would ship pins
 * that open nothing. They come back once the dungeon journals land.
 */
const COLLECTIONS = ["walls", "lights", "sounds", "tiles", "regions", "drawings"];

/** Fields that are per-world bookkeeping rather than authored content. */
const STRIP = new Set(["_id", "_key", "_stats"]);

function clean(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc)) {
    if (STRIP.has(k)) continue;
    out[k] = v;
  }
  return out;
}

/* -------------------------------------------- */

const db = new ClassicLevel(scenesDb, { keyEncoding: "utf8", valueEncoding: "json" });

try {
  await db.open();
} catch {
  console.error(
    `\nCould not open the world database. Foundry holds an exclusive lock while a\n` +
      `world is open — return to the setup screen and run this again.\n`
  );
  process.exit(1);
}

// Gather scenes and their embedded placeables in one pass.
const scenes = new Map();
const embedded = new Map(); // sceneId -> collection -> [doc]

for await (const [key, value] of db.iterator()) {
  if (key.startsWith("!scenes!")) {
    scenes.set(key.slice("!scenes!".length), value);
    continue;
  }
  const m = /^!scenes\.([a-z]+)!([^.]+)\./.exec(key);
  if (!m) continue;
  const [, collection, sceneId] = m;
  if (!COLLECTIONS.includes(collection)) continue;
  const perScene = embedded.get(sceneId) ?? new Map();
  perScene.set(collection, [...(perScene.get(collection) ?? []), value]);
  embedded.set(sceneId, perScene);
}

await db.close();

/* -------------------------------------------- */

let updated = 0;
const problems = [];

for (const [sceneId, scene] of scenes) {
  if (onlyScene && scene.name !== onlyScene) continue;

  const key = scene.flags?.[adventure.id]?.key;
  if (!key) {
    // Foundry's own welcome scene, or a scene the Ref made from scratch.
    if (!onlyScene) continue;
    problems.push(`"${scene.name}" carries no ${adventure.id} key — was it imported from the module?`);
    continue;
  }

  const srcFile = join(SRC_DIR, `${key}.json`);
  if (!existsSync(srcFile)) {
    problems.push(`"${scene.name}" points at ${key}.json, which does not exist`);
    continue;
  }

  const source = JSON.parse(readFileSync(srcFile, "utf8"));

  /**
   * Refuse to import geometry authored against different art.
   *
   * The deck ships several variants of the same map at different resolutions
   * (the labelled Blood Library is 3290x5180, the gridless one 5880x9100).
   * Walls drawn on one and written into the other would be silently misplaced
   * across the whole map — a failure that looks like nothing at export time
   * and like chaos at the table.
   */
  if (scene.width !== source.width || scene.height !== source.height) {
    problems.push(
      `"${scene.name}" is ${scene.width}x${scene.height} but ${key}.json is ` +
        `${source.width}x${source.height} — refusing to import placeables across a resolution change. ` +
        `Edit the scene imported from the module, not a different variant of the map.`
    );
    continue;
  }

  const counts = [];
  for (const collection of COLLECTIONS) {
    const docs = embedded.get(sceneId)?.get(collection) ?? [];
    if (!docs.length) {
      delete source[collection];
      continue;
    }

    // Sort for determinism: the pack builder derives embedded ids from array
    // position, so a stable order keeps ids stable across re-exports.
    const sorted = docs
      .map(clean)
      .sort((a, b) => (a.x ?? 0) - (b.x ?? 0) || (a.y ?? 0) - (b.y ?? 0) || JSON.stringify(a).localeCompare(JSON.stringify(b)));

    source[collection] = sorted;
    counts.push(`${sorted.length} ${collection}`);
  }

  // Carry across scene-level settings the Ref may have tuned while working.
  for (const field of ["tokenVision", "fog", "environment", "initial", "padding"]) {
    if (scene[field] !== undefined) source[field] = scene[field];
  }

  writeFileSync(srcFile, JSON.stringify(source, null, 2) + "\n");
  updated++;

  const doors = (embedded.get(sceneId)?.get("walls") ?? []).filter((w) => w.door > 0).length;
  console.log(
    `${scene.name} -> ${key}.json` + (counts.length ? `  (${counts.join(", ")}` + (doors ? `, ${doors} doors` : "") + ")" : "  (nothing placed yet)")
  );
}

console.log(`\n${updated} scene source file(s) updated`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(`  ! ${p}`);
}
if (updated) console.log(`\nNext: npm run packs:adventure && npm run deploy:adventure`);
