/**
 * Copy the built system into the local Foundry data directory.
 *
 * A COPY, not a junction. classic-level cannot open a LevelDB through a Windows
 * directory junction — its manifest renames fail with "path not found" and the
 * compendium packs silently never load while everything else appears to work.
 * (Learned the hard way in foundryvtt-golarion-maps; see its DECISIONS.md
 * 2026-07-17.) The copy also mirrors the release zip layout exactly.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const target = join(
  process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
  "FoundryVTT",
  "Data",
  "systems",
  "crows"
);

/** Exactly what ships. Keep in sync with the release workflow. */
const SHIP = ["system.json", "LICENSE", "NOTICE.md", "README.md", "dist", "lang", "templates", "packs", "assets"];

mkdirSync(target, { recursive: true });

for (const entry of SHIP) {
  const src = join(root, entry);
  if (!existsSync(src)) {
    console.warn(`skip (absent): ${entry}`);
    continue;
  }
  rmSync(join(target, entry), { recursive: true, force: true });
  cpSync(src, join(target, entry), { recursive: true });
  console.log(`copied ${entry}`);
}

console.log(`\ndeployed to ${target}`);
console.log("Restart Foundry (or reload the world) to pick up manifest changes.");
