/** Small text helpers shared by the ledger and the transcriber. */

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'has', 'have', 'in', 'is',
  'it', 'its', 'no', 'not', 'of', 'on', 'or', 'so', 'that', 'the', 'this', 'to', 'with', 'which',
])

export function contentTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  )
}

/** Jaccard over content words. Cheap, explainable, good enough at this scale. */
export function similarity(a: string, b: string): number {
  const ta = contentTokens(a)
  const tb = contentTokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  return shared / (ta.size + tb.size - shared)
}

/** What fraction of `part`'s content words appear in `whole`. */
export function coverage(part: string, whole: string): number {
  const tp = contentTokens(part)
  const tw = contentTokens(whole)
  if (tp.size === 0) return 0
  let shared = 0
  for (const t of tp) if (tw.has(t)) shared++
  return shared / tp.size
}
