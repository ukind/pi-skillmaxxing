# skillmaxxing — pi extension

Ports [`johnvouros/skillmaxxing`](https://github.com/johnvouros/skillmaxxing) into one local pi
extension. The extension vendors the upstream `agent-skills-system/` skill and registers it through
the `resources_discover` event, so the skill is lazy: it appears in `<available_skills>` and resolves
through `/skill:agent-skills-system`, and its body enters the context only when it is invoked.

`index.ts` registers one handler and nothing else. No `package.json`, no `tsconfig.json`, and no
build step: pi's extension loader accepts a subdirectory with `index.ts` and jiti transpiles it on
the fly. No `settings.json` entry either — the loader auto-scans `<agentDir>/extensions`.

## Install

Clone this repository straight into pi's extensions directory — the loader auto-scans `<agentDir>/extensions`,
so a clone is the whole installation. No build step, no `npm install`, no `settings.json` entry.

```bash
git clone https://github.com/ukind/pi-skillmaxxing.git ~/.pi/agent/extensions/skillmaxxing
```

Windows PowerShell:

```powershell
git clone https://github.com/ukind/pi-skillmaxxing.git "$env:USERPROFILE\.pi\agent\extensions\skillmaxxing"
```

Then run `/reload` in pi (or start a new session) to pick it up.

- **Verify** — run the self-check from anywhere: `node ~/.pi/agent/extensions/skillmaxxing/vendor.check.ts`
  must exit 0. It asserts the vendored-skill inventory, byte sizes, and `VERSION`.
- **Configure** (optional) — `~/.pi/agent/skillmaxxing.json` with
  `{ "enabled": true, "enforcement": "remind", "defaultMode": null }`, hand-edit then `/reload`.
  See [Configuration](#configuration) for the full key reference.
- **Update** — `git -C ~/.pi/agent/extensions/skillmaxxing pull`, then `/reload`.
- **Uninstall** — delete the clone directory, then `/reload`.

Line endings are handled for you: the repo carries a `.gitattributes` that forces LF on checkout,
because `vendor.check.ts` asserts byte sizes and a CRLF checkout would change every one of them.

## Vendored upstream content

- **Upstream repository** — `https://github.com/johnvouros/skillmaxxing.git`
- **Pinned commit** — `ae37d84505a10a23b1a7f5b236f32e8fa9beff80`
- **`VERSION`** — `0.3.0` (the staleness anchor)
- **Vendored subtree** — `<repo>/agent-skills-system/` copied to
  `extensions/skillmaxxing/skills/agent-skills-system/`, byte for byte. No reflow, no formatter
  pass, no line-ending conversion.

The copy is exactly 10 files:

| File | Bytes |
| --- | --- |
| `SKILL.md` | 5666 |
| `VERSION` | 6 |
| `agents/openai.yaml` | 297 |
| `references/context-state.md` | 1563 |
| `references/engineering-loops.md` | 2460 |
| `references/long-horizon.md` | 1645 |
| `references/modes.md` | 5255 |
| `references/security-autonomy.md` | 1917 |
| `references/tool-design.md` | 1372 |
| `references/verification.md` | 1549 |

`references/modes.md` is the authority for the six mode ids. `agents/openai.yaml` is inert to pi —
`loadSkillsFromDirInternal` returns as soon as it finds `SKILL.md` in a directory, so `references/`
and `agents/` are never walked — and is kept only so the copy stays byte-identical to the pin.

### Not vendored

| Excluded | Reason |
| --- | --- |
| repo-root `SKILL.md` (793 B) | A loader stub, not the skill. Vendoring it would register a 793 B body in place of the canonical 5666 B one. |
| `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `CONVENTIONS.md` | pi's resource loader collects `AGENTS.md` (and `CLAUDE.md`) as project context, so a vendored copy would inject upstream contributor notes into every prompt. |
| `.gitignore`, `.ignore`, `.fdignore` | An ignore file inside a scanned directory is applied by `addIgnoreRules` and could exclude `SKILL.md` from its own discovery. |
| upstream `README.md` | Superseded by this file. |
| `scripts/`, `evals/`, `tests/`, `docs/`, `templates/`, `assets/`, `dist/`, `CHANGELOG.md` | Development material with no runtime role in pi. |

### Update procedure

1. Clone the upstream repository into a scratch directory **outside** the agent root.
2. `git -C <scratch> checkout <new-commit>`.
3. Re-copy `<scratch>/agent-skills-system/` over
   `extensions/skillmaxxing/skills/agent-skills-system/`.
4. Bump the pin and the byte-size table in this file, and the pin, size table, and `VERSION` value in
   `extensions/skillmaxxing/vendor.check.ts`.
5. `node extensions/skillmaxxing/vendor.check.ts` must exit 0.
6. Delete the scratch clone. It is never vendored and never referenced at runtime.

Staleness detection is `diff -r` against a fresh clone of the pin, because the copy is
byte-identical. `vendor.check.ts` is the cheap form of the same check: it asserts the inventory, each
file's byte size, `VERSION`, and the headings the later phases slice against.

Clone with `core.autocrlf` set to `input` or `false`. A CRLF checkout changes every byte size and
`vendor.check.ts` fails.

### Recorded wart

Upstream `SKILL.md` ends by telling the reader to run `python3 scripts/validate.py` and
`python3 scripts/evaluate.py --references` "from this repository". `scripts/` is upstream
development material and is not vendored, so those two commands do not resolve here. The line is
left unedited because the copy is byte-identical to the pin.

## License

MIT. `extensions/skillmaxxing/LICENSE` is the upstream MIT license, copied verbatim from the pin.

<!-- Reserved headings: `## Configuration` (phase 2), `## Prompt injection` (phase 3),
     `## Migration record` (phase 4). Later phases append their own section; no phase rewrites
     another phase's section. -->

## Configuration

`~/.pi/agent/skillmaxxing.json`. The file is optional: with no file, the defaults below are in force.
The extension never writes it.

```json
{ "enabled": true, "enforcement": "remind", "defaultMode": null }
```

| Key | Domain | Default | Meaning |
|---|---|---|---|
| `enabled` | `true` \| `false` | `true` | Gates the mode machinery only. `false` leaves the `agent-skills-system` skill registered and `/skill:`-invocable, and removes the `set_mode` tool. |
| `enforcement` | `"remind"` \| `"block"` | `"remind"` | Carried here, interpreted by the prompt injection. Neither value ever denies a tool call. |
| `defaultMode` | one of the six mode ids, or `null` | `null` | Applied only when the live session branch holds no mode entry. |

Every field is clamped against its own domain on read: a wrong type, an unknown mode id, or an unknown
enforcement value falls back to the default for that field alone. Malformed JSON gives one error
notification that names the file, and the defaults stay in force.

Workflow: hand-edit the file, then run `/reload`. `/reload` calls `resourceLoader.reload()` →
`clearExtensionCache()`, which re-runs the extension factory and therefore the config read. There is no
`/mode` command and no settings pane: the only way to change these three keys is the file, and the only
way to change the active mode is the model calling `set_mode`.

The active mode lives in the session, not in this file. Each accepted `set_mode` call appends one
`custom` session entry with `customType: "skillmaxxing-mode"`; a repeat of the identical
`(mode, bottleneck)` pair appends nothing. Restore reads the live branch, so a fork or a branch switch
cannot resurrect a mode from a discarded branch. `mode: "none"` persists an explicit stand-down, which
beats `defaultMode` on the next restore.

## Prompt injection

The router text rides the `before_agent_start` `systemPrompt` return, the same channel
`extensions/simple-english/index.ts:454` uses. It is **not** a `ToolDefinition.promptGuidelines`
entry: `buildSystemPrompt` returns from inside `if (customPrompt)` before both the
`guidelinesList` construction and the `promptGuidelines` loop, and this tree has a live
full-prompt override (`<agentDir>/SYSTEM.md`, found by `discoverSystemPromptFile`). Declared
guidelines would therefore render nowhere today and would silently start rendering the day the
override is removed.

Three states, three costs. `store.get()` returning `null` (no entry on the live branch) is
distinct from a persisted `{ mode: null }` (an explicit `set_mode "none"` stand-down):

| Store state | Meaning | Injected | Measured |
| --- | --- | --- | --- |
| `null` | unset | router block + one enforcement line | 1,411 B `remind`, 1,470 B `block` |
| `{ mode: null }` | stood down | nothing | 0 B |
| `{ mode, bottleneck }` | committed | router + active line + verbatim pack + transitions + precedence | 2,496–2,911 B |

Measured against the pinned vendored tree at this install path, with a 22-character bottleneck
string: verbatim router table 1,208 B, authored precedence block 442 B, and a header line that
embeds the absolute `SKILL_DIR` (107 B here). Both variable parts add bytes on top — the
committed bottleneck is unbounded user text, and a deeper install path lengthens the header —
so `mode-packs.check.ts` asserts both unset variants under 1.5 KB and every one of the six modes
under 3 KB, and prints the measured numbers on every run.

`enforcement` is prompt language, never a denied tool call. It shapes exactly one line, and only
in the unset state — with a mode committed there is nothing left to enforce. `remind` states the
reminder; `block` is the imperative variant and states the routine-edit exemption. The extension
registers no `tool_call` handler, so a mutating call issued with no mode committed still
executes. The vendored `SKILL.md` forbids the coercive reading directly: "Do not force mode
narration into a routine, already-scoped edit unless routing changes the work."

Nothing is copied into TypeScript. `loadPackSource` slices the router table out of `SKILL.md`
§`## Route The Task` and the six packs plus the per-mode transition lines out of
`references/modes.md`, verbatim, at factory time. Pack keys come from the markdown, not from
`MODE_IDS`, which is what keeps the module free of runtime relative imports; set-equality is
asserted in the check instead. `/reload` re-runs the factory, so re-copying the vendored subtree
picks up new pack text with no extra machinery, and phase 1's byte-identical `diff -r` staleness
story keeps covering the only copy.

Precedence against the other live injectors. Chain order is fixed by the loader, not by
settings: the global-extensions pass over `<agentDir>/extensions` runs before the `settings.json`
`packages` loop, so `npm:pi-caveman` (`settings.json:32`) and ponytail (`settings.json:42`)
always land after this text. The reconciliation therefore has to be inside it, and it states
axes rather than a ranking, because each injector declares its own: prose form is caveman and
STE, solution size is ponytail
(`git/github.com/DietrichGebert/ponytail/hooks/ponytail-instructions.js:74`, "Ponytail governs
what you build, not how you talk"), and phase, order, and the required artifact are the pack.
The one measured collision — `rauch_mode`'s complete-states mandate against ponytail's polish
ban — resolves through ponytail's own carve-out for "anything the user explicitly asked to keep"
(`git/github.com/DietrichGebert/ponytail/hooks/ponytail-instructions.js:71`), with ponytail still
governing how much code each state costs. The precedence block ships only with a mode active.

Load faults split by blast radius. Either file unreadable, or `## Route The Task` missing, sets
`PackSource.error`: every state then injects nothing and one `session_start` error notification
names the file. A single missing pack section (a heading renamed upstream after a pin bump) still
ships the router block, the active-mode line, and one line naming the missing section and its
file — with a mode already committed, a named gap beats silent no-guidance.

## Migration record

### What was removed

The full-prompt override at the agent root, `SYSTEM.md`, renamed away in one `mv`. It suppressed pi's
whole built prompt through the `<agentDir>/SYSTEM.md` branch of `discoverSystemPromptFile`
(`npm/node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.js`). Sections removed,
by heading — re-derive the ranges in the archive with
`grep -n '^## ' SYSTEM.md.pre-skillmaxxing.bak`, because the file was formatter-reflowed more than
once and any range quoted here is only as-of the archive:

- the preamble and `Adapter Rules` line
- `## 1. CORE PRINCIPLES (Non-negotiable)`
- `## 2. DECISION SYSTEM`, including the `### Priority Hierarchy` order string, which omitted
  Authority, Safety, and Verifiability — as always-on text it was a weaker copy sitting permanently
  above the stronger lazy one
- `## 3. MODE PACKS (CRITICAL)` — all six eager packs, including the `rauch_mode` pack whose
  complete-states mandate collided with ponytail's polish ban. Phase 3's precedence block is now the
  only copy of that reconciliation.
- `## 4. ROUTING LOGIC`
- `## 5. CONFLICT MATRIX` (fork-only, dropped, not ported)
- `## 6. SAME TASK, MULTIPLE MODES` (fork-only, dropped, not ported)
- `## 7. FINAL OUTPUT FORMAT`, including `### Minimal Operating Rule`

No `APPEND_SYSTEM.md` and no `<cwd>/.pi/SYSTEM.md` was created in its place. That is deliberate:
`@tintinweb/pi-subagents` suppresses `AGENTS.md`, `CLAUDE.md`, and `APPEND_SYSTEM.md` for subagents
because upstream `buildSystemPrompt()` re-appends them after `systemPromptOverride`
(the comment at `npm/node_modules/@tintinweb/pi-subagents/src/agent-runner.ts:587`), so residue there
would reach the parent session and be stripped from every subagent — a split-brain contract across
exactly the boundary this migration removes.

### Archive and rollback

- archive: `23362 B`
- archive sha256: `30d97cafda2a7f7e6e04fae85ba527cfc82cbfaeac8e1bda51566d1feb954627`

The archive is `SYSTEM.md.pre-skillmaxxing.bak` at the agent root, byte-identical because `mv`
preserves bytes (403 lines, measured with `wc -l -c` and `sha256sum` on the live file immediately
before the rename), and it is the sole rollback path — this agent directory is not a git repository.
Restore with one command from the agent root:

`mv SYSTEM.md.pre-skillmaxxing.bak SYSTEM.md`

It was inert where it sat: `discoverSystemPromptFile` and `discoverAppendSystemPromptFile` each do two
exact-basename `existsSync` checks, `loadContextFileFromDir` has a fixed `AGENTS.md`/`CLAUDE.md`
candidate list, and `loadTemplatesFromDir` never scans the agent root.

**Rollback path lost:** `SYSTEM.md.pre-skillmaxxing.bak` is no longer present at the agent root, so
the `mv … SYSTEM.md` restore above no longer works and the rollback is irreversible. The size and
sha256 above are kept as the historical record of the pre-rename file; `migration.check.ts` was
retired with the archive because its assertions were byte-pinned and could not be regenerated.

### The three gates

The rename happened only after gates 1 and 2 passed against a live prompt fixture captured with
`SYSTEM.md` still present. A failed gate is a phase 1 or phase 3 defect, not a migration problem, and
the file stays.

1. The vendored skill is live: the pre-rename fixture carries an `<available_skills>` entry naming
   `agent-skills-system` with a `<location>` under
   `extensions/skillmaxxing/skills/agent-skills-system/`.
2. Phase 3's injector is live *through* the override: the pre-rename fixture contains both
   `## 3. MODE PACKS (CRITICAL)` and `Mode router (source:` — the deliberate two-copy window, and the
   in-situ proof that the injection channel clears the full-prompt override. The same fixture contains
   no `Available tools:` section, no `Guidelines:` section, and no
   `You are an expert coding assistant operating inside pi` line.
3. `set_mode` round trip: after `set_mode { mode: "theo_mode", … }` the next turn's prompt carries the
   verbatim `` ## `theo_mode` `` section including its `Switch signal:` bullet. This gate needs a live
   model turn, so it is **not** discharged by the fixtures above; `packFor` is covered instead by
   `node extensions/skillmaxxing/mode-packs.check.ts`, and the in-session round trip is left as a
   manual criterion.

A zero-copy window is not reachable, because the rename is the last step.

### Measured system-prompt size

Both fixtures were captured in `pi -p … --no-session` runs started with
`PI_CACHE_OPTIMIZER_NO_PROMPT_REWRITE=1`
(`npm/node_modules/pi-cache-optimizer/index.ts:103` names the variable,
`npm/node_modules/pi-cache-optimizer/index.ts:7225` is the early return), so these bytes are pi's
built prompt. The prompt actually shipped on the default path is `pi-cache-optimizer`'s rewrite of it,
which is a different size.

Instrument, and why it is not `/export`: `/export` is an interactive slash command and cannot be
driven from a non-interactive implement run. The same string was read instead by a throwaway
extension held **outside** the agent root and loaded with `-e`, which dumps the system message of the
outgoing provider request from `before_provider_request` and exits before the network call. That fires
after every `before_agent_start` handler, so the fixture is the prompt as shipped — the same quantity
`/export` renders from `state.systemPrompt`. Reading it at `before_agent_start` instead would capture
the prompt mid-chain and miss this extension's own injection.

- before rename: `60855 B`
- after rename: `55127 B`

The delta is **not a 23 KB saving** — it is 5,728 B, and no un-measured saving is claimed here. The
override was suppressing pi's identity line, the `Available tools:` list, the whole `Guidelines:`
section, and the pi documentation block; all four came back with the rename. The number above is the
whole claim.

### Revived promptGuidelines

Eight installed packages declare `promptGuidelines`. Seven revive in a normal parent session, because
`buildSystemPrompt` returns inside `if (customPrompt)` before the section that renders them and the
override is now gone:

- `@juicesharp/rpiv-todo`
- `@ff-labs/pi-fff`
- `@juicesharp/rpiv-advisor`
- `@juicesharp/rpiv-ask-user-question`
- `@juicesharp/rpiv-web-tools`
- `@tintinweb/pi-subagents`
- `pi-mono-figma` (`npm/node_modules/pi-mono-figma/src/figma-tools.ts:81`)

Two exclusions. `pi-intercom` declares four bullets but does **not** revive here: its only declaring
tool, `contact_supervisor`, registers solely behind the child-orchestrator gate
(`npm/node_modules/pi-intercom/index.ts:1506`, the declaration at
`npm/node_modules/pi-intercom/index.ts:1512`). `pi-cache-optimizer` declares none — it only *reads*
`opts.promptGuidelines` when building a cache prefix
(`npm/node_modules/pi-cache-optimizer/index.ts:565`) and lifts each bullet into a stable prefix
(`npm/node_modules/pi-cache-optimizer/index.ts:753`), which is why a revived bullet is asserted
prompt-wide and never scoped to inside the `Guidelines:` heading.

The revived block measures 8,448 B across 54 lines in the after fixture, from the `Guidelines:` line
to the blank line before the pi documentation block. It was reviewed against the injected router text
and is not self-contradictory enough to need its own slice (risk `r6`): every bullet is tool-usage
mechanics, and the only overlap with the mode contract — rpiv-advisor's escalation bullets — sits on a
different axis than mode routing.

### Out-of-tree readers

- `@tintinweb/pi-subagents` builds its subagent prompt and passes it as
  `systemPromptOverride: () => systemPrompt`
  (`npm/node_modules/@tintinweb/pi-subagents/src/agent-runner.ts:645`). Subagents therefore stop
  inheriting the fork entirely.
- `context-mode` never read this file on pi. Its **pi** adapter's `getInstructionFiles()` returns
  `["AGENTS.md"]` (`npm/node_modules/context-mode/build/adapters/pi/index.js:86`); only its **omp**
  adapter names `SYSTEM.md` (`npm/node_modules/context-mode/build/adapters/omp/index.js:102`). A
  missing file is a non-event twice over.

### Behavior change: `enabled: false`

Before the migration the mode contract was unconditional prompt text. After it, with
`{"enabled": false}` in `~/.pi/agent/skillmaxxing.json`, the contract is a manifest line plus explicit
invocation only: the vendored skill stays in the skills index and stays
`/skill:agent-skills-system`-invocable, but `set_mode` is not registered and no router, pack, or
precedence text is injected. This is recorded here rather than left for a later bug report.
