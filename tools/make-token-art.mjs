/**
 * Generate the default crow token art.
 *
 * The problem this solves is a table problem, not an art one: Foundry's stock
 * `mystery-man.svg` is a PALE figure on transparency, so on a map with the
 * room lights on it washes into the floor and a player cannot find their own
 * token. Adding a shaded disc BEHIND the figure gives it its own contrast that
 * does not depend on what it is standing on.
 *
 * Built as SVG and rasterised so it stays editable text in the repo rather
 * than a binary nobody can adjust, and so the whole set regenerates from one
 * command when a colour changes.
 *
 * Usage: node tools/make-token-art.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(root, "assets", "tokens");

const SIZE = 512;

/**
 * One token.
 *
 * @param {object} opts
 * @param {string} opts.hood   Fill for the hood and shoulders.
 * @param {string} opts.face   Fill for the void inside the hood.
 * @param {string} opts.rim    Ring colour, the disposition tell.
 * @param {string} opts.disc   Centre of the shade disc.
 */
function tokenSVG({ hood, face, rim, disc, beak = "#3d372f" }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
  <defs>
    <!-- THE SHADE. Opaque at the centre and fading at the edge, so the token
         reads against a lit floor without looking like a pasted-on coin. -->
    <radialGradient id="shade" cx="50%" cy="46%" r="52%">
      <stop offset="0%"   stop-color="${disc}" stop-opacity="0.97"/>
      <stop offset="62%"  stop-color="${disc}" stop-opacity="0.93"/>
      <stop offset="88%"  stop-color="${disc}" stop-opacity="0.72"/>
      <stop offset="100%" stop-color="${disc}" stop-opacity="0"/>
    </radialGradient>

    <!-- The hood is lit from above-left, the way a torch would catch it. -->
    <linearGradient id="cloth" x1="0.22" y1="0" x2="0.8" y2="1">
      <stop offset="0%"   stop-color="${hood}"/>
      <stop offset="55%"  stop-color="${hood}" stop-opacity="0.88"/>
      <stop offset="100%" stop-color="${hood}" stop-opacity="0.62"/>
    </linearGradient>

    <!-- The hollow of the hood: darkest at the top where the cowl overhangs. -->
    <radialGradient id="hollow" cx="50%" cy="38%" r="62%">
      <stop offset="0%"   stop-color="${face}"/>
      <stop offset="70%"  stop-color="${face}"/>
      <stop offset="100%" stop-color="${face}" stop-opacity="0.82"/>
    </radialGradient>
  </defs>

  <circle cx="256" cy="256" r="248" fill="url(#shade)"/>
  <circle cx="256" cy="256" r="234" fill="none" stroke="${rim}" stroke-opacity="0.55" stroke-width="6"/>
  <circle cx="256" cy="256" r="222" fill="none" stroke="#000" stroke-opacity="0.35" stroke-width="2"/>

  <g>
    <!-- Shoulders and cloak, kept inside the disc so nothing clips the ring. -->
    <path d="M 256 172
             C 322 172, 356 214, 366 268
             C 388 292, 404 330, 412 384
             C 356 410, 306 420, 256 420
             C 206 420, 156 410, 100 384
             C 108 330, 124 292, 146 268
             C 156 214, 190 172, 256 172 Z"
          fill="url(#cloth)"/>

    <!-- The cowl. -->
    <path d="M 256 148
             C 320 148, 358 196, 358 258
             C 358 300, 340 330, 316 346
             C 300 356, 278 360, 256 360
             C 234 360, 212 356, 196 346
             C 172 330, 154 300, 154 258
             C 154 196, 192 148, 256 148 Z"
          fill="url(#cloth)"/>

    <!-- The void where a face would be. This is what makes it read as a crow
         rather than a person: you never see who is under the hood. -->
    <path d="M 256 186
             C 302 186, 330 222, 330 262
             C 330 296, 312 322, 288 336
             C 277 342, 267 344, 256 344
             C 245 344, 235 342, 224 336
             C 200 322, 182 296, 182 262
             C 182 222, 210 186, 256 186 Z"
          fill="url(#hollow)"/>

    <!-- Two catchlights. The only bright pixels in the hollow, so the eye
         lands on the face at any zoom. -->
    <circle cx="232" cy="252" r="10" fill="${rim}" opacity="0.95"/>
    <circle cx="280" cy="252" r="10" fill="${rim}" opacity="0.95"/>

    <!-- A beak, BELOW the eyes and a shade lighter than the hollow.
         A black beak on a black hollow is invisible, and the first attempt
         also carried a half-width highlight that made it read as lopsided. -->
    <path d="M 256 272 L 278 300 L 256 312 L 234 300 Z" fill="${beak}"/>
  </g>
</svg>`;
}

/**
 * Three tones, and they have to stay far apart.
 *
 * The first attempt made everything near-black — thematically right for crows
 * in black pelts, and completely illegible: hood, hollow and disc were the
 * same value and the silhouette vanished. The figure has to be the LIGHT
 * element against a dark disc, which is also what makes it survive a lit room:
 * pale shape, dark ground, and the contrast travels with the token instead of
 * depending on the floor under it.
 */
const VARIANTS = {
  // The player default: pale cowl, black hollow, gold eyes.
  "crow": { hood: "#cfc2a8", face: "#0a0908", rim: "#c9a227", disc: "#0e0c0b" },
  // A crow who has died, for the roster.
  "crow-dead": { hood: "#8d8074", face: "#0a0808", rim: "#9d2222", disc: "#0f0b0b" },
  // Generic humans the party meets.
  "human": { hood: "#b9a98d", face: "#141110", rim: "#e6dcc8", disc: "#12100e" },
  // Anything hostile.
  "hostile": { hood: "#9c8a86", face: "#0a0606", rim: "#d33a3a", disc: "#120b0b" }
};

async function main() {
  mkdirSync(OUT, { recursive: true });

  for (const [name, opts] of Object.entries(VARIANTS)) {
    const svg = tokenSVG(opts);
    writeFileSync(join(OUT, `${name}.svg`), svg);
    await sharp(Buffer.from(svg), { density: 288 })
      .resize(SIZE, SIZE)
      .webp({ quality: 92, alphaQuality: 100 })
      .toFile(join(OUT, `${name}.webp`));
    console.log(`assets/tokens/${name}.webp`);
  }
  console.log(`\n${Object.keys(VARIANTS).length} token images written.`);
}

main();
