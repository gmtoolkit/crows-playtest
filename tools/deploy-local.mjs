/**
 * Copy a built package into the local Foundry data directory.
 *
 *   node tools/deploy-local.mjs --target system
 *   node tools/deploy-local.mjs --target adventure
 *
 * A COPY, not a junction. classic-level cannot open a LevelDB through a Windows
 * directory junction — its manifest renames fail with "path not found" and the
 * compendium packs silently never load while everything else appears to work.
 * (Learned the hard way in foundryvtt-golarion-maps; see its DECISIONS.md
 * 2026-07-17.) The copy also mirrors the release zip layout exactly.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { targetFromArgs } from "./packages.mjs";

const target = targetFromArgs();

const dataDir = join(
  process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
  "FoundryVTT",
  "Data"
);
const dest = join(dataDir, target.installDir, target.id);

mkdirSync(dest, { recursive: true });

for (const entry of target.ship) {
  const src = join(target.root, entry);
  if (!existsSync(src)) {
    console.warn(`skip (absent): ${entry}`);
    continue;
  }
  try {
    rmSync(join(dest, entry), { recursive: true, force: true });
    cpSync(src, join(dest, entry), { recursive: true });
  } catch (err) {
    // Foundry holds an exclusive lock on every open compendium LevelDB, so a
    // running world makes `packs` undeletable. The error itself says only
    // EPERM, which sends you looking for a permissions problem that is not
    // there.
    if (err.code === "EPERM" && entry === "packs") {
      console.error(
        `\nCannot replace ${entry}: Foundry has the compendium databases open.\n` +
          `Return to the setup screen (or close Foundry) and run this again.\n`
      );
      process.exit(1);
    }
    throw err;
  }
  console.log(`copied ${entry}`);
}

console.log(`\n[${target.id}] deployed to ${dest}`);
