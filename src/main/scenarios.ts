import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Locale } from '../shared/i18n'
import type { Scenario } from '../shared/types'

const RUBRIC = /<!--\s*RUBRIC:START[\s\S]*?RUBRIC:END\s*-->/g
/** Localized briefs live in the same file as the rubric, so they cannot drift
 *  apart from the requirements the review is judged against. */
const BRIEF_BLOCK = /<!--\s*BRIEF:([a-z]{2})\s*-->([\s\S]*?)<!--\s*\/BRIEF:\1\s*-->/g

/**
 * Reads the scenario bank.
 *
 * The rubric is stripped here, in the main process, before the brief ever
 * reaches the renderer. If you can read the answer key you are not practising —
 * and a rubric that merely isn't rendered is one devtools inspection away from
 * being read.
 */
export async function listScenarios(root: string, locale: Locale = 'en'): Promise<Scenario[]> {
  let files: string[]
  try {
    files = (await readdir(join(root, 'scenarios'))).filter((f) => f.endsWith('.md'))
  } catch {
    return []
  }

  const scenarios = await Promise.all(
    files.map(async (file) => {
      // Normalized on read: scenario files are edited by hand, and a file saved
      // by a Windows editor arrives with CRLF, which quietly stops the
      // frontmatter and brief markers from matching.
      const raw = (await readFile(join(root, 'scenarios', file), 'utf-8')).replace(
        /\r\n/g,
        '\n',
      )
      const id = file.replace(/\.md$/, '')
      const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(raw)
      const meta = frontmatter ? parseFrontmatter(frontmatter[1]!) : {}
      const withoutRubric = (frontmatter ? raw.slice(frontmatter[0].length) : raw).replace(RUBRIC, '')

      // A localized brief replaces the default one; every other language's
      // block is removed so it never leaks into the panel.
      const localized = [...withoutRubric.matchAll(BRIEF_BLOCK)].find((m) => m[1] === locale)
      const body = (localized ? localized[2]! : withoutRubric.replace(BRIEF_BLOCK, '')).trim()

      return {
        id: meta.id ?? id,
        title: meta[`title_${locale}`] ?? meta.title ?? id,
        difficulty: Number(meta.difficulty ?? 1),
        brief: body,
      }
    }),
  )

  return scenarios.sort((a, b) => a.difficulty - b.difficulty || a.title.localeCompare(b.title))
}

function parseFrontmatter(block: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of block.split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line.trim())
    if (match) out[match[1]!] = match[2]!.replace(/^["']|["']$/g, '')
  }
  return out
}
