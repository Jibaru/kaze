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

## Your own scenarios

`+ New scenario` asks for a topic and Claude writes the whole brief — including
the hidden rubric the review grades against. There is deliberately no rubric
field: it is hidden so you cannot design to it, and writing it yourself would
hand you the answer key. The app is the only thing that ever reads that section
back. Hand-editing is one button away for anyone who wants it; scenarios are
plain markdown in the workspace.

## Idioma

La interfaz esta en espanol por defecto; el ingles se elige en la barra inferior.
El revisor responde en el idioma de la interfaz, incluido el resumen hablado, y
la transcripcion de voz se envia con el idioma correcto. Los nombres de servicios
de AWS, los ids de nodo y el documento `kaze-adl` que se escribe en disco quedan
siempre en ingles: son nombres propios o superficie legible por maquina, y un
diseno serializado en espanol dejaria de coincidir con los hallazgos que lo
referencian.

The interface is Spanish by default; English is a click away in the status bar.

## Installing it

```bash
npm install
npm run dist
```

That writes a per-user Windows installer to `dist/` — `Kaze Setup 0.1.0.exe`.
It needs no administrator, puts Kaze in the Start menu and on the desktop, and
uninstalls from Settings like anything else. It is unsigned, so SmartScreen
will warn on the first run: **More info → Run anyway**.

`npm run dist` also builds a `.dmg` on macOS and an `AppImage` on Linux, from
the same config.

## Running it from source

```bash
npm install
npm run dev
```

`npm run dev` reloads the renderer as you edit and restarts main when it
changes. `npm run build && npm start` runs the built app instead, which is what
the installer ships.

## What it needs

- **Claude Code, installed and logged in.** Kaze drives the `claude` on your
  PATH over your existing OAuth session; there is no API key and no separate
  account. It falls back to the SDK's own bundled binary if it cannot find
  yours, which works but is not the one you are used to.
- **An OpenAI key, for voice only.** Paste it into the field in the status bar.
  It is encrypted with the OS keystore and never leaves the main process.
  Without one the app still reviews, still writes, still draws — it just does
  not listen or speak, and conversation mode is unavailable.

Your work lives in `%APPDATA%/kaze/workspace` (`~/Library/Application Support`
on macOS): scenarios you write, every numbered revision, the findings ledger,
and the attempts you set aside with **Empezar de cero**. Nothing there is ever
deleted by the app.

| | |
|---|---|
| `npm run check` | offline suites (269 checks) |
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
| **Conversar** | design out loud: the diagram and nothing else, microphone open |
| Hold **Space** *(in conversation)* | talk regardless of what the detector thinks |
| **Ctrl+1 / 2 / 3** | inspector · design text · review |
| **Ctrl+Enter** | review without speaking |
| **Escape** | stop the turn |
| **Ctrl+S** | save |
