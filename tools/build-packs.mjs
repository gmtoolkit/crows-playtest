/**
 * Compile `<target>/packs-src/<pack>/*.json` into LevelDB compendium packs and
 * register them in that target's manifest.
 *
 *   node tools/build-packs.mjs --target system
 *   node tools/build-packs.mjs --target adventure
 *
 * Written directly with classic-level rather than @foundryvtt/foundryvtt-cli.
 * Three v14 facts make that worth the 40 lines (all learned the hard way in
 * foundryvtt-golarion-maps, see its DECISIONS.md 2026-07-17):
 *
 *  1. Embedded collections are stored as SEPARATE sub-entries keyed
 *     `!<collection>.<embedded>!<parentId>.<childId>`, with the parent
 *     carrying only an array of ids. Inline children are silently dropped.
 *  2. Every entry — parents AND embedded children — needs
 *     `_stats.coreVersion`. Without it the server treats the document as
 *     pre-v14, migrates it, and synthesises defaults over your data.
 *  3. Document ids must be deterministic, or every rebuild churns ids and
 *     re-importing duplicates documents instead of updating them.
 */
import { ClassicLevel } from "classic-level";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { targetFromArgs, CORE_VERSION } from "./packages.mjs";

const target = targetFromArgs();
const root = target.root;
const SRC = join(root, "packs-src");
const OUT = join(root, "packs");

const PACK_CORE_VERSION = CORE_VERSION;
const PACKS = target.packs;

/** Embedded collections shipped as sub-entries, by document type. */
const EMBEDDED = {
  Actor: ["items", "effects"],
  Item: ["effects"],
  Scene: ["levels", "notes", "tokens", "lights", "walls", "sounds", "regions", "templates", "tiles"],
  JournalEntry: ["pages"],
  RollTable: ["results"]
};

/** Deterministic 16-char id from a stable seed. */
export function did(seed) {
  return createHash("sha1").update(`crows:${seed}`).digest("hex").slice(0, 16);
}

function stamp(doc) {
  // systemId stays "crows" even for module packs: it names the system the
  // documents are FOR, which is what Foundry validates against.
  doc._stats = { coreVersion: PACK_CORE_VERSION, systemId: "crows", ...doc._stats };
  return doc;
}

/* -------------------------------------------- */

let totalDocs = 0;
const built = [];

for (const pack of PACKS) {
  const srcDir = join(SRC, pack.name);
  if (!existsSync(srcDir)) {
    console.log(`skip ${pack.name} (no packs-src/${pack.name})`);
    continue;
  }

  const files = readdirSync(srcDir).filter((f) => f.endsWith(".json"));
  if (!files.length) {
    console.log(`skip ${pack.name} (empty)`);
    continue;
  }

  const packDir = join(OUT, pack.name);
  rmSync(packDir, { recursive: true, force: true });
  mkdirSync(packDir, { recursive: true });

  const db = new ClassicLevel(packDir, { keyEncoding: "utf8", valueEncoding: "json" });
  await db.open();
  const batch = db.batch();

  const folders = new Map();
  let count = 0;
  let embeddedCount = 0;

  for (const file of files.sort()) {
    const doc = JSON.parse(readFileSync(join(srcDir, file), "utf8"));

    // Ids come from the document's own stable key, never from the filename
    // alone, so renaming a source file does not orphan the document.
    const key = doc.__key ?? file.replace(/\.json$/, "");
    delete doc.__key;
    doc._id = did(`${pack.name}:${key}`);

    // Optional folder placement, declared per document.
    if (doc.__folder) {
      const folderName = doc.__folder;
      delete doc.__folder;
      if (!folders.has(folderName)) {
        folders.set(
          folderName,
          stamp({
            _id: did(`folder:${pack.name}:${folderName}`),
            name: folderName,
            type: pack.type,
            folder: null,
            sorting: "a",
            sort: 0,
            color: null,
            flags: {}
          })
        );
      }
      doc.folder = folders.get(folderName)._id;
    }

    stamp(doc);

    // Split embedded collections out into their own entries.
    for (const collection of EMBEDDED[pack.type] ?? []) {
      const entries = doc[collection];
      if (!Array.isArray(entries) || !entries.length) continue;

      doc[collection] = entries.map((child, i) => {
        child._id ??= did(`${pack.name}:${key}:${collection}:${child.name ?? i}`);
        stamp(child);
        batch.put(`!${pack.collection}.${collection}!${doc._id}.${child._id}`, child);
        embeddedCount++;
        return child._id;
      });
    }

    batch.put(`!${pack.collection}!${doc._id}`, doc);
    count++;
  }

  for (const folder of folders.values()) batch.put(`!folders!${folder._id}`, folder);

  await batch.write();
  await db.close();

  totalDocs += count;
  built.push({ ...pack, count });
  console.log(
    `${pack.name}: ${count} documents` +
      (embeddedCount ? `, ${embeddedCount} embedded` : "") +
      (folders.size ? `, ${folders.size} folders` : "")
  );
}

/* -------------------------------------------- */
/*  Register the built packs in the manifest    */
/* -------------------------------------------- */

const manifest = JSON.parse(readFileSync(target.manifest, "utf8"));

manifest.packs = built.map((p) => ({
  name: p.name,
  label: p.label,
  path: `packs/${p.name}`,
  type: p.type,
  system: "crows",
  // Stat blocks, dungeon keys and random tables are the Ref's business.
  ownership: p.gmOnly
    ? { PLAYER: "NONE", ASSISTANT: "OWNER" }
    : { PLAYER: "OBSERVER", ASSISTANT: "OWNER" }
}));

writeFileSync(target.manifest, JSON.stringify(manifest, null, 2) + "\n");

console.log(`\n[${target.id}] ${totalDocs} documents across ${built.length} packs`);
console.log(`manifest updated (${manifest.packs.map((p) => p.name).join(", ") || "none"})`);
