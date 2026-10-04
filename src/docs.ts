/**
 * search_docs: keyword search over the bundled Strait docs (src/docs-index.json,
 * built from the website's docs by scripts/build-docs-index.mjs). Offline: no
 * network call, so it works in every client and never leaks the query.
 */
import index from './docs-index.json' with { type: 'json' };

export interface DocSection {
  page: string;
  group: string;
  section: string | null;
  url: string;
  markdown: string;
}

export interface DocHit extends DocSection {
  score: number;
}

const SECTIONS: DocSection[] = (index as { sections: DocSection[] }).sections;

const STOP = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does', 'for', 'from', 'how', 'i', 'in', 'is', 'it', 'my', 'of', 'on', 'or', 'the', 'to', 'what', 'when', 'why', 'with', 'you', 'your', 'strait']);

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[`*_#>\[\]()|]/g, ' ')
    .split(/[^a-z0-9.+-]+/)
    .map((t) => t.replace(/^[.+-]+|[.+-]+$/g, ''))
    .filter((t) => t.length > 1 && !STOP.has(t));
}

interface Indexed {
  s: DocSection;
  tf: Map<string, number>;
  head: Set<string>;
  len: number;
}

let built: { docs: Indexed[]; df: Map<string, number>; avg: number } | null = null;
function build(sections: DocSection[]) {
  const docs = sections.map((s) => {
    const words = tokens(s.markdown);
    const tf = new Map<string, number>();
    for (const w of words) tf.set(w, (tf.get(w) ?? 0) + 1);
    return { s, tf, head: new Set(tokens(`${s.page} ${s.section ?? ''}`)), len: words.length };
  });
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set([...d.tf.keys(), ...d.head])) df.set(w, (df.get(w) ?? 0) + 1);
  const avg = docs.reduce((n, d) => n + d.len, 0) / Math.max(1, docs.length);
  return { docs, df, avg };
}

/** BM25 over section text, plus a boost when a query word is in the page title or section heading. */
export function searchDocs(query: string, limit = 5, sections: DocSection[] = SECTIONS): DocHit[] {
  const { docs, df, avg } = sections === SECTIONS ? (built ??= build(SECTIONS)) : build(sections);
  const q = [...new Set(tokens(query))];
  if (!q.length) return [];
  const N = docs.length;
  const k1 = 1.2;
  const b = 0.75;
  const hits: DocHit[] = [];
  for (const d of docs) {
    let score = 0;
    for (const w of q) {
      const n = df.get(w) ?? 0;
      if (!n) continue;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const f = d.tf.get(w) ?? 0;
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avg)));
      if (d.head.has(w)) score += idf * 1.5;
    }
    if (score > 0) hits.push({ ...d.s, score: Math.round(score * 100) / 100 });
  }
  return hits.sort((x, y) => y.score - x.score).slice(0, Math.max(1, Math.min(limit, 20)));
}

export const DOCS_SECTION_COUNT = SECTIONS.length;
