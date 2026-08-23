/**
 * The two things this repo publishes.
 *
 * `crows` is the SYSTEM: the rules engine, the sheets, and the content that is
 * the game itself — gear, spellbooks, backgrounds, traits, and the bestiary.
 * Anyone running Crows needs all of it regardless of what they play.
 *
 * `crows-cornath` is a MODULE: the published playtest adventure — the maps, the
 * Blood Library and the Floating Manor, the POIs and the village. A Ref running
 * their own dungeons in their own setting needs none of it, which is exactly
 * why it is separable (and why a takedown request is cheap to honour).
 *
 * The bestiary sits in the system deliberately: the Ref Book's creatures are
 * the game's monster rules, not this adventure's cast. Moving it is a one-line
 * change here if that call turns out wrong.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** Foundry build this repo is verified against. */
export const CORE_VERSION = "14.365";

export const PACKAGES = {
  system: {
    id: "crows",
    kind: "system",
    root: repoRoot,
    manifest: join(repoRoot, "system.json"),
    /** Where Foundry installs it, relative to its Data directory. */
    installDir: "systems",
    ship: ["system.json", "LICENSE", "NOTICE.md", "README.md", "dist", "lang", "templates", "packs", "assets"],
    packs: [
      { name: "creatures", label: "Crows: Bestiary", type: "Actor", collection: "actors", gmOnly: true },
      { name: "weapons", label: "Crows: Weapons", type: "Item", collection: "items" },
      { name: "armor", label: "Crows: Armor", type: "Item", collection: "items" },
      { name: "gear", label: "Crows: Gear", type: "Item", collection: "items" },
      { name: "spellbooks", label: "Crows: Spellbooks", type: "Item", collection: "items" },
      { name: "traits", label: "Crows: Traits", type: "Item", collection: "items" },
      { name: "backgrounds", label: "Crows: Backgrounds", type: "Item", collection: "items" },
      { name: "tables", label: "Crows: Tables", type: "RollTable", collection: "tables", gmOnly: true }
    ]
  },

  adventure: {
    id: "crows-cornath",
    kind: "module",
    root: join(repoRoot, "adventure"),
    manifest: join(repoRoot, "adventure", "module.json"),
    installDir: "modules",
    ship: ["module.json", "LICENSE", "NOTICE.md", "README.md", "packs", "assets"],
    packs: [
      { name: "scenes", label: "Cornath: Maps", type: "Scene", collection: "scenes" },
      { name: "journals", label: "Cornath: Dungeons & Lore", type: "JournalEntry", collection: "journal", gmOnly: true }
    ]
  }
};

/** Resolve a --target argument, defaulting to the system. */
export function targetFromArgs(argv = process.argv.slice(2)) {
  const i = argv.indexOf("--target");
  const key = i >= 0 ? argv[i + 1] : "system";
  const pkg = PACKAGES[key];
  if (!pkg) {
    throw new Error(`unknown --target "${key}". Expected one of: ${Object.keys(PACKAGES).join(", ")}`);
  }
  return pkg;
}

/** Every target, for commands that build both. */
export function allTargets() {
  return Object.values(PACKAGES);
}
