import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

/**
 * Find the Claude Code the user actually installed.
 *
 * The Agent SDK ships its own CLI binary and will happily use it. That works —
 * same OAuth, same `~/.claude` — but it is a different build from the one on the
 * user's PATH, and the whole premise here is "the Claude Code I have installed".
 * So resolve theirs, and fall back to the SDK's only if there isn't one.
 *
 * On Windows the PATH entry is a `.cmd` shim; the SDK needs the real executable,
 * which npm places next to the shim under `node_modules/@anthropic-ai/claude-code/bin`.
 */
export function resolveInstalledClaude(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)

  for (const dir of dirs) {
    const packaged = join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
    if (existsSync(packaged)) return packaged

    for (const name of ['claude.exe', 'claude']) {
      const candidate = join(dir, name)
      // Skip the shims: a .cmd/.ps1 wrapper is not something to hand a spawner.
      if (existsSync(candidate) && !candidate.endsWith('.cmd') && !candidate.endsWith('.ps1')) {
        return candidate
      }
    }
  }

  return undefined
}
