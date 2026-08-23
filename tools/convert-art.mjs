/**
 * Convert the playtest art into web-friendly assets under `assets/`.
 *
 * The packet ships JPEGs up to 71 MB and 19,500 px tall. Foundry cannot use
 * the print set at all — WebGL texture limits cap out around 16,384 px — and
 * even the VTT set is heavy over a network. WebP at quality 82 cuts the map
 * set by roughly 75% with no visible loss at table zoom.
 *
 * Maps: the filenames encode the grid in squares (…_42x65_Blood-Library-Full)
 * and the pixel dimensions divide by it EXACTLY (5880/42 = 9100/65 = 140), so
 * the grid size is read, never guessed. That figure is written to
 * `assets/maps.json` for the scene builder.
 *
 * Usage:
 *   node tools/convert-art.mjs --src "/path/to/MCDM Crows Public Playtest ..."
 */
import { mkdirSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const args = process.argv.slice(2);
const srcIndex = args.indexOf("--src");
const SRC =
  srcIndex >= 0
    ? args[srcIndex + 1]
    : "C:/Users/Cliff/Downloads/MCDM Crows Public Playtest August-Sept 2026/MCDM Crows Public Playtest August-Sept 2026";

if (!existsSync(SRC)) {
  console.error(`Playtest packet not found at:\n  ${SRC}\nPass --src "/path/to/packet".`);
  process.exit(1);
}

const OUT_MAPS = join(root, "assets", "maps");
const OUT_ART = join(root, "assets", "art");
const OUT_THUMBS = join(root, "assets", "thumbs");
for (const d of [OUT_MAPS, OUT_ART, OUT_THUMBS]) mkdirSync(d, { recursive: true });

/** Recursively list files under a directory. */
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Grid dimensions encoded in a MAD Cartographer filename: `_42x65_`. */
function gridFromName(name) {
  const m = /[_\s](\d{1,3})x(\d{1,3})[_\s.]/.exec(name);
  return m ? { cols: Number(m[1]), rows: Number(m[2]) } : null;
}

/** A stable, URL-safe key for an asset. */
function slug(s) {
  return s
    .replace(/\.[^.]+$/, "")
    .replace(/^MAD_MCDM_CROWS_/i, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/* -------------------------------------------- */
/*  Maps                                        */
/* -------------------------------------------- */

const mapFiles = walk(join(SRC, "Maps")).filter((p) => /\.(jpe?g|png)$/i.test(p));

/**
 * Prefer the 140ppi VTT set over the 300ppi print set (too large for WebGL),
 * and gridless over gridded — Foundry draws its own grid, and a baked grid
 * fights it at any offset.
 */
function mapPriority(path) {
  const p = path.replace(/\\/g, "/");
  let score = 0;
  if (/140ppi/i.test(p)) score += 100;
  if (/300ppi|Print/i.test(p)) score -= 100;
  if (/Gridless/i.test(p)) score += 10;
  if (/Gridded/i.test(p)) score -= 5;
  if (/No Labels/i.test(p)) score += 3;
  return score;
}

const maps = [];

for (const file of mapFiles) {
  const rel = relative(SRC, file).replace(/\\/g, "/");
  // Skip the print set outright: 12600x19500 exceeds what Foundry can texture.
  if (/300ppi|_Print_/i.test(rel)) {
    console.log(`skip (print resolution): ${rel}`);
    continue;
  }

  const name = basename(file);
  const grid = gridFromName(name);
  const key = slug(name);
  const outPath = join(OUT_MAPS, `${key}.webp`);

  const image = sharp(file, { limitInputPixels: false });
  const meta = await image.metadata();

  // The grid size must divide evenly. If it does not, the filename and the
  // art disagree and a guessed grid would silently misalign every token.
  let gridSize = null;
  if (grid) {
    const byWidth = meta.width / grid.cols;
    const byHeight = meta.height / grid.rows;
    if (Number.isInteger(byWidth) && byWidth === byHeight) {
      gridSize = byWidth;
    } else {
      console.warn(
        `  ! ${name}: grid ${grid.cols}x${grid.rows} does not divide ${meta.width}x${meta.height} ` +
          `(${byWidth} vs ${byHeight}); leaving grid unset rather than guessing`
      );
    }
  }

  await image.webp({ quality: 82, effort: 5 }).toFile(outPath);
  const outMeta = await sharp(outPath).metadata();

  await sharp(file, { limitInputPixels: false })
    .resize({ width: 480, withoutEnlargement: true })
    .webp({ quality: 78 })
    .toFile(join(OUT_THUMBS, `${key}.webp`));

  maps.push({
    key,
    source: rel,
    file: `assets/maps/${key}.webp`,
    thumb: `assets/thumbs/${key}.webp`,
    width: outMeta.width,
    height: outMeta.height,
    grid: grid ? { cols: grid.cols, rows: grid.rows, size: gridSize } : null,
    priority: mapPriority(file),
    gridless: /Gridless|No Labels/i.test(rel),
    labels: /Labels/i.test(rel) && !/No Labels/i.test(rel)
  });

  const before = statSync(file).size;
  const after = statSync(outPath).size;
  console.log(
    `${key}  ${outMeta.width}x${outMeta.height}` +
      (gridSize ? `  grid ${gridSize}px (${grid.cols}x${grid.rows})` : "  no grid") +
      `  ${(before / 1e6).toFixed(1)}MB -> ${(after / 1e6).toFixed(1)}MB`
  );
}

/* -------------------------------------------- */
/*  Monster and location illustrations          */
/* -------------------------------------------- */

const artFiles = walk(join(SRC, "Monster Illustrations")).filter((p) => /\.(jpe?g|png)$/i.test(p));
const art = [];

for (const file of artFiles) {
  const rel = relative(SRC, file).replace(/\\/g, "/");
  const key = slug(basename(file));
  const outPath = join(OUT_ART, `${key}.webp`);

  // Illustrations are display art, not maps: 1600px wide is plenty for a
  // journal or an actor portrait and keeps the module light.
  await sharp(file, { limitInputPixels: false })
    .resize({ width: 1600, withoutEnlargement: true })
    .webp({ quality: 84 })
    .toFile(outPath);

  // Square token art, centre-cropped, for the ones that are creatures.
  const tokenPath = join(OUT_ART, `${key}-token.webp`);
  await sharp(file, { limitInputPixels: false })
    .resize({ width: 512, height: 512, fit: "cover", position: "attention" })
    .webp({ quality: 84 })
    .toFile(tokenPath);

  art.push({
    key,
    source: rel,
    file: `assets/art/${key}.webp`,
    token: `assets/art/${key}-token.webp`,
    category: rel.includes("Blood Creatures") ? "blood" : rel.includes("Undead") ? "undead" : "other"
  });

  console.log(
    `${key}  ${(statSync(file).size / 1e6).toFixed(1)}MB -> ${(statSync(outPath).size / 1e6).toFixed(1)}MB (+token)`
  );
}

writeFileSync(join(root, "assets", "maps.json"), JSON.stringify({ maps, art }, null, 2) + "\n");
console.log(`\n${maps.length} maps, ${art.length} illustrations -> assets/maps.json`);
