/**
 * Grid-layout PDF extraction, for the printed inventory card decks.
 *
 * The rulebooks are a two-column flow (see pdf-text.mjs). The card decks are
 * not: they are a GRID of cards, five across, and reading them as columns
 * interleaves five different cards into one line —
 * "Hammer Stack 2 Mace Stack 1 Knife Stack 2 Sword Stack 1 Handaxe Stack 2".
 *
 * Cards butt against each other with no empty vertical band between them, so
 * the occupancy-gap trick that finds a column gutter finds nothing here. What
 * DOES work: card text starts at the card's left edge, so a histogram of
 * line-start x across the whole deck shows one sharp peak per card column.
 *
 * Measured on the Playtest 2 annotated deck: peaks at x = 18, 126, 234, 342,
 * 450 — exactly 108pt apart — and rows 188pt apart. The card's crafting and
 * price footer is set at 7.5pt against 11pt body text, which separates the
 * footer from the card body without parsing it.
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFileSync } from "node:fs";

/** Items whose baselines are within this many points are the same line. */
const LINE_TOLERANCE = 3;

/** Footer text (crafting requirements, price) is set smaller than the body. */
const FOOTER_MAX_FONT = 9;

/**
 * Extract a card-grid PDF into an array of cards.
 *
 * @param {string} path
 * @param {object} [opts]
 * @param {number} [opts.minPeak]  Items needed at an x for it to be a column edge.
 * @returns {Promise<Array<{page:number,row:number,col:number,lines:string[],footer:string[]}>>}
 */
export async function extractCards(path, { minPeak = 20 } = {}) {
  const data = new Uint8Array(readFileSync(path));
  const doc = await getDocument({ data, useSystemFonts: true }).promise;

  const pages = [];
  let pageWidth = 0;
  let pageHeight = 0;

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    pageWidth = Math.max(pageWidth, viewport.width);
    pageHeight = Math.max(pageHeight, viewport.height);

    const content = await page.getTextContent();
    pages.push(
      content.items
        .filter((i) => typeof i.str === "string" && i.str.trim() !== "")
        .map((i) => ({
          text: i.str,
          x: i.transform[4],
          y: viewport.height - i.transform[5],
          width: i.width,
          // transform[3] is the vertical scale, i.e. the rendered font size.
          font: Math.abs(i.transform[3])
        }))
    );
  }

  const all = pages.flat();
  const columns = detectColumns(all, minPeak);
  if (columns.length < 2) throw new Error(`could not detect card columns in ${path}`);

  const colPitch = columns[1] - columns[0];

  /**
   * Cards are segmented by the FOOTER, not by a row grid.
   *
   * A fixed row pitch looked right on the opening pages and then fell apart:
   * later spreads carry taller cards (tables, two-slot weapons), their content
   * crosses the assumed band, and text lands in the neighbouring card. Card
   * height is simply not constant across the deck.
   *
   * What IS structural: every card ends with a small-set block (crafting
   * requirements, price). So walking one column top to bottom, a transition
   * from footer-size text back to body-size text is a new card — regardless of
   * how tall either card happens to be.
   */
  const cards = [];
  for (const [pageIndex, items] of pages.entries()) {
    for (let c = 0; c < columns.length; c++) {
      const x0 = columns[c] - 4; // slack: some glyphs start left of the edge
      const x1 = columns[c] + colPitch - 4;

      const column = items.filter((i) => i.x >= x0 && i.x < x1).sort((a, b) => a.y - b.y);
      if (!column.length) continue;

      // Group into lines first, so the font test is per line, not per glyph.
      const lines = cellToLines(column, { keepOrder: true });

      let current = null;
      let sawFooter = false;
      for (const line of lines) {
        if (line.isFooter) {
          if (current) current.footer.push(line.text);
          sawFooter = true;
          continue;
        }
        // Body text after a footer (or at the very top) starts a new card.
        if (!current || sawFooter) {
          current = { page: pageIndex + 1, col: c, lines: [], footer: [] };
          cards.push(current);
          sawFooter = false;
        }
        current.lines.push(line.text);
      }
    }
  }

  await doc.cleanup?.();
  // Reading order: page, then down each column, then across.
  return cards.filter((c) => c.lines.length || c.footer.length);
}

/* -------------------------------------------- */

/**
 * Card column left edges, from a histogram of where text starts.
 *
 * Only peaks that form an evenly-spaced run are kept — an indented block
 * inside a card also produces a peak, but it will not sit on the card pitch.
 */
function detectColumns(items, minPeak) {
  const hist = new Map();
  for (const i of items) {
    const bucket = Math.round(i.x / 2) * 2;
    hist.set(bucket, (hist.get(bucket) ?? 0) + 1);
  }

  const peaks = [...hist.entries()]
    .filter(([, n]) => n >= minPeak)
    .map(([x]) => x)
    .sort((a, b) => a - b);
  if (peaks.length < 2) return peaks;

  // The card pitch is the most common spacing between peaks.
  const diffs = new Map();
  for (let i = 1; i < peaks.length; i++) {
    const d = peaks[i] - peaks[i - 1];
    if (d < 40) continue; // too close to be a card boundary
    diffs.set(d, (diffs.get(d) ?? 0) + 1);
  }
  if (!diffs.size) return peaks;

  const pitch = [...diffs.entries()].sort((a, b) => b[1] - a[1])[0][0];

  // Keep the longest run of peaks separated by that pitch.
  let best = [];
  for (let start = 0; start < peaks.length; start++) {
    const run = [peaks[start]];
    for (let i = start + 1; i < peaks.length; i++) {
      if (Math.abs(peaks[i] - run.at(-1) - pitch) <= 3) run.push(peaks[i]);
    }
    if (run.length > best.length) best = run;
  }
  return best;
}

/* -------------------------------------------- */

/**
 * Turn one cell's items into ordered lines, splitting the small-set footer
 * (crafting requirements and price) from the card body.
 *
 * Baselines are clustered BEFORE sorting horizontally — the same trap as the
 * rulebook extractor: a label and its value can differ by a fraction of a
 * point, and y-first ordering emits them out of order.
 */
function cellToLines(cell, { keepOrder = false } = {}) {
  const sorted = [...cell].sort((a, b) => a.y - b.y);

  const clusters = [];
  let cluster = null;
  for (const item of sorted) {
    if (cluster && Math.abs(item.y - cluster.y) <= LINE_TOLERANCE) cluster.items.push(item);
    else {
      cluster = { y: item.y, items: [item] };
      clusters.push(cluster);
    }
  }

  const ordered = [];

  for (const c of clusters) {
    c.items.sort((a, b) => a.x - b.x);
    let text = "";
    let endX = null;
    for (const item of c.items) {
      if (endX !== null && item.x - endX > 1.2) text += " ";
      text += item.text;
      endX = item.x + item.width;
    }
    text = text.replace(/\s+/g, " ").trim();
    if (!text) continue;

    const smallest = Math.min(...c.items.map((i) => i.font));
    ordered.push({ text, isFooter: smallest <= FOOTER_MAX_FONT, y: c.y });
  }

  // Segmentation needs the lines in document order with their font class;
  // callers that just want a cell's contents get them pre-split.
  if (keepOrder) return ordered;

  return {
    lines: ordered.filter((l) => !l.isFooter).map((l) => l.text),
    footer: ordered.filter((l) => l.isFooter).map((l) => l.text)
  };
}
