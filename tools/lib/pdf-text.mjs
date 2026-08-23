/**
 * PDF text extraction, in pure Node so `npm run extract` works for anyone with
 * their own copy of the playtest packet.
 *
 * The books are laid out in columns, and naive extraction interleaves them into
 * nonsense. Text items are therefore grouped into lines by their Y coordinate
 * and then, within a page, split into columns by X so each column is read top
 * to bottom before moving right — which is how a human reads the page and how
 * the stat-block parser expects it.
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFileSync } from "node:fs";

/** Items whose baselines are within this many points are the same line. */
const LINE_TOLERANCE = 3;

/**
 * Extract a PDF into an array of pages, each an array of text lines.
 *
 * @param {string} path
 * @param {object} [opts]
 * @param {number} [opts.columns]  Force a column count; otherwise detected.
 * @returns {Promise<string[][]>}
 */
export async function extractPages(path, { columns = null } = {}) {
  const data = new Uint8Array(readFileSync(path));
  const doc = await getDocument({ data, useSystemFonts: true }).promise;

  // Pass 1: collect positioned items for every page.
  const raw = [];
  let pageWidth = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    pageWidth = Math.max(pageWidth, viewport.width);

    raw.push(
      content.items
        .filter((i) => typeof i.str === "string" && i.str.trim() !== "")
        .map((i) => ({
          text: i.str,
          // transform is [a,b,c,d,e,f]; e,f are the translation.
          x: i.transform[4],
          y: viewport.height - i.transform[5],
          width: i.width,
          // Needed so document-wide gutter detection does not conflate the
          // same baseline on different pages into one row.
          page: p
        }))
    );
  }

  /**
   * The gutter is found ONCE for the whole document, not per page.
   *
   * Per-page detection failed exactly where it mattered: on spreads where two
   * creature stat blocks sit side by side, their tables straddle the middle
   * often enough that no band looks empty, the page falls back to one column,
   * and the two blocks interleave into unusable soup. The page grid is fixed
   * across a book, so aggregating every page's occupancy finds the true gutter
   * even when individual pages obscure it.
   */
  const gutter = columns === 1 ? null : findGutter(raw.flat(), pageWidth, raw.length);

  const pages = raw.map((items) => itemsToLines(items, { gutter }));

  await doc.cleanup?.();
  return pages;
}

/**
 * Group positioned items into reading-order lines.
 */
function itemsToLines(items, { gutter }) {
  if (!items.length) return [];

  // An item belongs to the right column only if it STARTS past the gutter;
  // anything straddling it (a full-width table row or heading) stays left, so
  // it is read as one line rather than torn in half.

  for (const item of items) {
    item.column = gutter !== null && item.x >= gutter ? 1 : 0;
  }

  /**
   * Cluster baselines into lines BEFORE sorting horizontally.
   *
   * Sorting by raw y then x is subtly wrong: a label and its value on the same
   * visual line can differ by a fraction of a point, and y-first ordering then
   * emits them out of order. That produced "Stamina: 15 10 10Speed: Slots:"
   * instead of "Stamina: 15 Speed: 10 Slots: 10" — values ahead of their own
   * labels, which silently corrupted a fifth of the stat blocks.
   */
  const lines = [];
  for (const column of [0, 1]) {
    const inColumn = items.filter((i) => i.column === column).sort((a, b) => a.y - b.y);
    if (!inColumn.length) continue;

    const clusters = [];
    let cluster = null;
    for (const item of inColumn) {
      if (cluster && Math.abs(item.y - cluster.y) <= LINE_TOLERANCE) {
        cluster.items.push(item);
      } else {
        cluster = { y: item.y, items: [item] };
        clusters.push(cluster);
      }
    }

    for (const c of clusters) {
      // Now, and only now, order left to right.
      c.items.sort((a, b) => a.x - b.x);
      let text = "";
      let endX = null;
      for (const item of c.items) {
        // Insert a space when the gap suggests separate words or table cells.
        if (endX !== null && item.x - endX > 1.5) text += " ";
        text += item.text;
        endX = item.x + item.width;
      }
      lines.push({ column, y: c.y, text });
    }
  }

  lines.sort((a, b) => a.column - b.column || a.y - b.y);
  return lines.map((l) => l.text.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/**
 * Find the real column gutter, if the page has one.
 *
 * Splitting at the page midpoint is wrong and was actively destructive: the
 * stat blocks are mini-tables laid out INSIDE one column, and a midpoint split
 * tore "Stamina: 15 Speed: 5 Slots: 10" into "Stamina: 15 10 10Speed: Slots:"
 * by sorting the labels and their values into different columns.
 *
 * A genuine gutter is a vertical band that is empty for nearly the whole page
 * height. A gap between table cells is empty for only a few rows, so requiring
 * the band to be clear across most text rows separates the two cleanly.
 *
 * @returns {number|null} The x coordinate to split at, or null for one column.
 */
function findGutter(items, pageWidth, pageCount = 1) {
  if (items.length < 20) return null;

  // Distinct text baselines, keyed by page so the same y on two pages counts
  // as two rows rather than one.
  const rows = new Set(items.map((i) => `${i.page ?? 0}:${Math.round(i.y)}`));
  if (rows.size < 8) return null;

  const RESOLUTION = 2; // points per bucket
  const buckets = Math.ceil(pageWidth / RESOLUTION);

  // rowsCovering[b] = how many distinct rows have text crossing bucket b.
  const rowsCovering = new Array(buckets).fill(0);
  const seen = new Set();

  for (const item of items) {
    const row = `${item.page ?? 0}:${Math.round(item.y)}`;
    const from = Math.max(0, Math.floor(item.x / RESOLUTION));
    const to = Math.min(buckets - 1, Math.ceil((item.x + item.width) / RESOLUTION));
    for (let b = from; b <= to; b++) {
      const key = `${b}|${row}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rowsCovering[b]++;
    }
  }

  /**
   * A gutter bucket is crossed by almost no rows. Aggregated over a whole book
   * the signal is strong, but a few full-width tables legitimately cross the
   * gutter, so this tolerates a small percentage rather than demanding zero.
   */
  const threshold = Math.max(1, Math.floor(rows.size * 0.03));
  const isGutter = rowsCovering.map((n) => n <= threshold);

  // Longest empty run whose centre sits in the middle third of the page.
  const lowBound = pageWidth * 0.33;
  const highBound = pageWidth * 0.67;

  let best = null;
  let runStart = null;
  for (let b = 0; b <= buckets; b++) {
    if (b < buckets && isGutter[b]) {
      runStart ??= b;
      continue;
    }
    if (runStart !== null) {
      const startX = runStart * RESOLUTION;
      const endX = b * RESOLUTION;
      const centre = (startX + endX) / 2;
      const width = endX - startX;
      if (centre >= lowBound && centre <= highBound && width >= 10) {
        if (!best || width > best.width) best = { centre, width };
      }
      runStart = null;
    }
  }

  return best ? best.centre : null;
}

/** Flatten pages into one array of lines with page markers preserved. */
export function flatten(pages) {
  const out = [];
  pages.forEach((lines, i) => {
    out.push(`<<<PAGE ${i + 1}>>>`);
    out.push(...lines);
  });
  return out;
}
