/**
 * Generate scene documents from the converted maps.
 *
 * Grid size is never guessed: `convert-art.mjs` proved each map's pixels
 * divide exactly by the square count encoded in its filename (Blood Library
 * 5880/42 = 9100/65 = 140px; Floating Manor 6230/89 = 3780/54 = 70px), and
 * that verified figure is what lands here. A token dropped on these scenes
 * snaps to the printed grid with no calibration.
 *
 * v14 stores the background on an embedded LEVEL, not on the scene — the old
 * flat `background.src` is gone, and a scene written the old way loads with no
 * art at all.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(root, "packs-src", "scenes");

const manifestPath = join(root, "assets", "maps.json");
if (!existsSync(manifestPath)) {
  console.error("assets/maps.json not found. Run `npm run art` first.");
  process.exit(1);
}
const { maps } = JSON.parse(readFileSync(manifestPath, "utf8"));

const SYSTEM = "crows";
const GRID_SQUARE = 1;
const GRID_GRIDLESS = 0;

/**
 * Which variant of each map to ship as a scene.
 *
 * Gridless art wins: Foundry draws its own grid, and a baked grid that is even
 * a pixel off the scene grid produces a visible double-image at every square.
 * The labelled versions are shipped too but hidden from navigation — they are
 * the Ref's reference copy, since the labels give away room numbers.
 */
const SCENES = [
  {
    key: "gridless-140ppi-vtt-42x65-blood-library-full",
    name: "Blood Library",
    nav: true,
    order: 10,
    folder: "Blood Library",
    darkness: 1,
    notes: "Both floors on one canvas. Craelin's library, now a nest."
  },
  {
    key: "gridless-140ppi-vtt-42x24-blood-library-upper",
    name: "Blood Library — Upper Floor",
    nav: true,
    order: 11,
    folder: "Blood Library",
    darkness: 1
  },
  {
    key: "gridless-140ppi-vtt-42x41-blood-library-lower",
    name: "Blood Library — Lower Floor",
    nav: true,
    order: 12,
    folder: "Blood Library",
    darkness: 1
  },
  {
    key: "blood-library-labels-47x74",
    name: "Blood Library (Ref key)",
    nav: false,
    order: 13,
    folder: "Blood Library",
    darkness: 0,
    refOnly: true
  },
  {
    key: "floating-manor-no-labels-89x54",
    name: "The Floating Manor",
    nav: true,
    order: 20,
    folder: "Floating Manor",
    darkness: 1
  },
  {
    key: "floating-manor-labels-89x54",
    name: "The Floating Manor (Ref key)",
    nav: false,
    order: 21,
    folder: "Floating Manor",
    darkness: 0,
    refOnly: true
  },
  {
    key: "cornath-map-temp",
    name: "Cornath",
    nav: true,
    order: 1,
    folder: "Overland",
    darkness: 0,
    gridless: true,
    notes: "The overland map. Travel is measured in 5-mile hexes."
  }
];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const byKey = new Map(maps.map((m) => [m.key, m]));
let written = 0;

for (const spec of SCENES) {
  const map = byKey.get(spec.key);
  if (!map) {
    console.warn(`! no converted map for "${spec.key}" — skipping ${spec.name}`);
    continue;
  }

  const useGrid = !spec.gridless && map.grid?.size;

  const scene = {
    __key: spec.key,
    __folder: spec.folder,
    name: spec.name,
    navigation: spec.nav,
    navOrder: spec.order,
    width: map.width,
    height: map.height,
    padding: 0.1,
    thumb: `systems/${SYSTEM}/${map.thumb}`,

    grid: {
      type: useGrid ? GRID_SQUARE : GRID_GRIDLESS,
      // The verified figure, or Foundry's minimum if this map has no grid.
      size: useGrid ? map.grid.size : 100,
      style: "solidLines",
      thickness: 1,
      color: "#000000",
      alpha: useGrid ? 0.15 : 0,
      distance: 5,
      units: "ft"
    },

    // Dungeons are dark. Crows without a light source cannot see, and that is
    // the whole tension of the torch economy — so scenes start unlit.
    environment: {
      darknessLevel: spec.darkness ?? 0,
      globalLight: { enabled: spec.darkness ? false : true }
    },
    tokenVision: !!spec.darkness,

    fog: { mode: 2 },

    // v14: the background lives on an embedded level.
    levels: [
      {
        name: "Ground",
        elevation: { bottom: 0, top: 20 },
        background: { src: `systems/${SYSTEM}/${map.file}`, color: "#000000" },
        sort: 0
      }
    ],

    flags: {
      [SYSTEM]: {
        sourceImage: map.source,
        gridVerified: !!useGrid,
        gridSquares: map.grid ? `${map.grid.cols}x${map.grid.rows}` : null,
        refOnly: !!spec.refOnly
      }
    },

    // Ref-key scenes carry the printed room numbers; players should not browse
    // them from the compendium.
    ownership: spec.refOnly ? { default: 0 } : { default: 0 }
  };

  const file = join(OUT, `${spec.key}.json`);
  writeFileSync(file, JSON.stringify(scene, null, 2) + "\n");
  written++;

  console.log(
    `${spec.name}  ${map.width}x${map.height}` +
      (useGrid ? `  grid ${map.grid.size}px (${map.grid.cols}x${map.grid.rows} squares)` : "  gridless")
  );
}

console.log(`\n${written} scenes -> packs-src/scenes/`);
