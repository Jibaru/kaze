# Kaze

Practise AWS system design out loud, against your own installed Claude Code.

Pick a scenario, draw the architecture on a canvas with real AWS service icons,
hold **Space** and say *"review this"*. Claude Code reads the diagram as text,
reviews it against a hidden rubric, speaks a summary and files the findings. Fix
something, review again, and watch that finding flip to **resolved**.

## How it works

- **The reviewer is your Claude Code.** The app drives the `claude` binary on
  your PATH over your existing OAuth login — no API key, same skills, sessions in
  the same `~/.claude/projects/` store. It is given a read-only toolset
  (`Read`, `Grep`, `Glob`, `Skill`) and cannot write to the workspace.
- **The diagram becomes text.** A purpose-built YAML format carries nodes,
  edges, boundaries and configuration — plus a `gaps:` section the app computes
  itself: unconnected nodes, untyped edges, single-AZ datastores, missing backup
  policies. What you left out is what an interviewer attacks.
- **Findings have identity.** A ledger on disk tracks each finding as
  `new` / `open` / `resolved` / `regressed` across revisions, reconciled by the
  app rather than trusted from the model, so a reworded review never reads as a
  fix.
- **Voice is OpenAI, the thinking is not.** `gpt-4o-transcribe` in,
  `gpt-4o-mini-tts` out. The key is encrypted with the OS keystore and never
  leaves the main process.

## Running it

```bash
npm install
npm run dev
```

You need Claude Code installed and logged in. Paste an OpenAI key into the voice
bar to enable speech; everything else works without one.

| | |
|---|---|
| `npm run check` | offline suites (92 checks) |
| `npm run check:live` | end-to-end review + the fix-and-resolve loop (costs money) |
| `npm run check:voice` | speech round trip (needs `OPENAI_API_KEY`) |

## Look and feel

The interface follows Google's own developer-site system, taken from the values
that site ships rather than from an impression of it: Roboto and Roboto Mono
(self-hosted, so the app renders offline and its CSP stays closed to remote
origins), `#fff` / `#f8f9fa` / `#f1f3f4` surfaces, `#202124` text, `#1a73e8`
primary, Material elevation and pill-shaped actions. Google Sans carries the
headings where the machine has it and falls back to Roboto where it does not.

Colour is a two-tier system — primitives name a value, semantic tokens name a
job — and every text pair is measured rather than judged. Two border roles
exist because they answer different questions: `--border` separates surfaces,
`--border-control` outlines inputs and clears the 3:1 non-text minimum.

`PLAN.md` records the design decisions and why each one was made.

## Keys

| | |
|---|---|
| Hold **Space** | review the current design |
| Hold **Shift+Space** | ask a question instead |
| **Ctrl+1 / 2 / 3** | inspector · design text · review |
| **Ctrl+Enter** | review without speaking |
| **Escape** | stop the turn |
| **Ctrl+S** | save |
