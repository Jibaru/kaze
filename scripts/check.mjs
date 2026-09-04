/**
 * Runs a .mts check script through esbuild so it resolves imports the same way
 * the app's bundler does. Node's own type stripping needs explicit file
 * extensions on every import, and bending app source to suit a test runner is
 * the wrong way round.
 *
 * Usage: node scripts/check.mjs scripts/check-adl.mts [--print]
 */
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const entry = process.argv[2]
if (!entry) {
  console.error('usage: node scripts/check.mjs <script.mts> [args...]')
  process.exit(2)
}

// Inside the project, not the temp dir: externals have to resolve against the
// project's node_modules, and the SDK must stay external so it can find its CLI.
const dir = resolve('node_modules/.kaze-check')
mkdirSync(dir, { recursive: true })
const outfile = join(dir, 'check.mjs')

try {
  await build({
    entryPoints: [resolve(entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    alias: { '@shared': resolve('src/shared') },
    // The SDK resolves its CLI relative to its own package files; inlining it
    // breaks that. Electron is never loadable outside the app.
    external: ['@anthropic-ai/claude-agent-sdk', 'electron'],
    logLevel: 'warning',
  })
  await import(pathToFileURL(outfile).href)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
