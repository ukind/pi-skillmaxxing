import { readFileSync } from "node:fs";
import { join } from "node:path";
// Type-only: fully erased, so this module has zero runtime relative imports and
// `node extensions/skillmaxxing/mode-packs.check.ts` runs under plain node (risk r4).
import type { Enforcement, ModeId, ModeState } from "./mode-state";

/** `SKILL.md` heading whose section is the router table. Absence is a load fault (D7). */
export const ROUTER_HEADING = "## Route The Task";
/** `references/modes.md` heading holding the five `- \`<from> -> <to>\`: …` lines. */
export const TRANSITIONS_HEADING = "## Common Transitions";

/** A pack heading in `references/modes.md`, e.g. ``## `theo_mode` ``. */
const PACK_HEADING = /^## `([a-z0-9_]+)`$/;
/** A transition line, e.g. ``- `theo_mode -> rauch_mode`: …``. */
const TRANSITION_LINE = /^- `([a-z0-9_]+) -> [a-z0-9_]+`:/;

export interface PackSource {
	/** `SKILL.md` §Route The Task, verbatim (16 lines: lead-in, 6-row table, read-line, guard). */
	readonly routerTable: string;
	/** `references/modes.md` §`<id>` per mode, verbatim. Keys come from the file, not MODE_IDS. */
	readonly packs: Readonly<Record<string, string>>;
	/** The `- \`<id> -> <other>\`: …` lines whose source is `<id>`; "" when the mode is a sink. */
	readonly transitions: Readonly<Record<string, string>>;
	/** Absolute skill dir, echoed in the injected header so the pack's relative links resolve. */
	readonly skillDir: string;
	/** Set only on a load fault (file unreadable, or the router heading missing). */
	readonly error?: string;
}

/**
 * Verbatim slice from the line equal to `heading` up to the next line starting with "## ".
 * No reflow, no trimming of inner blank lines; trailing blank lines are dropped so the
 * injection carries no dangling whitespace. The result stays a verbatim substring of
 * `markdown`, which is what `mode-packs.check.ts` asserts. Returns null when absent.
 */
export function extractSection(
	markdown: string,
	heading: string,
): string | null {
	// Split on "\n" only: a CRLF copy keeps its "\r" inside the slice, so the result is
	// still a byte-for-byte substring of the source file.
	const lines = markdown.split("\n");
	const start = lines.findIndex((line) => line.trimEnd() === heading);
	if (start === -1) {
		return null;
	}
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		if (lines[i]?.startsWith("## ")) {
			end = i;
			break;
		}
	}
	return lines.slice(start, end).join("\n").trimEnd();
}

/** Sync, never throws. Reads `<skillDir>/SKILL.md` and `<skillDir>/references/modes.md`. */
export function loadPackSource(skillDir: string): PackSource {
	const skillPath = join(skillDir, "SKILL.md");
	const modesPath = join(skillDir, "references", "modes.md");

	let skillMd: string;
	let modesMd: string;
	try {
		skillMd = readFileSync(skillPath, "utf8");
		modesMd = readFileSync(modesPath, "utf8");
	} catch (cause) {
		const reason = cause instanceof Error ? cause.message : String(cause);
		return {
			routerTable: "",
			packs: {},
			transitions: {},
			skillDir,
			error: `skillmaxxing: cannot read the vendored pack files (${skillPath}, ${modesPath}): ${reason}. No mode text is injected.`,
		};
	}

	const routerTable = extractSection(skillMd, ROUTER_HEADING);
	if (routerTable === null) {
		return {
			routerTable: "",
			packs: {},
			transitions: {},
			skillDir,
			error: `skillmaxxing: heading "${ROUTER_HEADING}" is missing from ${skillPath}. No mode text is injected.`,
		};
	}

	const modesLines = modesMd.split("\n");
	const packs: Record<string, string> = {};
	for (const line of modesLines) {
		const heading = line.trimEnd();
		const match = PACK_HEADING.exec(heading);
		if (!match?.[1]) {
			continue;
		}
		const section = extractSection(modesMd, heading);
		if (section !== null) {
			packs[match[1]] = section;
		}
	}

	// Every discovered pack gets a key, so a sink mode reads "" rather than undefined.
	const transitions: Record<string, string> = {};
	for (const id of Object.keys(packs)) {
		transitions[id] = "";
	}
	const transitionsSection = extractSection(modesMd, TRANSITIONS_HEADING);
	if (transitionsSection !== null) {
		for (const line of transitionsSection.split("\n")) {
			const entry = line.trimEnd();
			const match = TRANSITION_LINE.exec(entry);
			if (!match?.[1]) {
				continue;
			}
			const from = match[1];
			const seen = transitions[from];
			transitions[from] = seen ? `${seen}\n${entry}` : entry;
		}
	}

	return { routerTable, packs, transitions, skillDir };
}

/**
 * The unset-state line. `enforcement` shapes only this line. The deny decision lives in
 * `gateDecision` below and is unconditional: no carve-out, no config key.
 */
const ENFORCEMENT_LINES: Readonly<Record<Enforcement, string>> = {
	remind:
		'No mode is committed. Call set_mode before non-trivial work. Pass mode "none" to stand down.',
	block:
		'No mode is committed. Do not start non-trivial work until set_mode is called. Pass mode "none" to stand down.',
};

/**
 * The block reason. Names the fix and the stand-down path. Carries no routine-edit
 * carve-out: the gate denies every tool but `set_mode`, so an exemption here would
 * contradict it (FR3). `mode-packs.check.ts` pins the text.
 */
export const GATE_REASON =
	'No mode is committed for this turn. Call set_mode before any other tool, then retry the blocked call. Pass mode "none" to stand down.';

/**
 * Pure. The whole gate policy: `(committed, toolName) → deny | allow`.
 *
 * `undefined` is an allow, which is the handler's "no opinion" result (`types.d.ts:902`).
 * Never sets `terminate`: an all-blocked batch would end the run before `set_mode` could
 * recover (`types.d.ts:822-826`).
 *
 * The transport is allowlisted too. In full-code mode every tool call arrives as
 * `fabric_exec`, and `set_mode` is reachable only inside its program. A blocked
 * transport deadlocks the session with no way out. The gate yields there, and the
 * advisory layer does the teaching.
 */
export function gateDecision(
	committed: boolean,
	toolName: string,
): { block: true; reason: string } | undefined {
	if (committed || toolName === "set_mode" || toolName === "fabric_exec") {
		return undefined;
	}
	return { block: true, reason: GATE_REASON };
}

/**
 * Authored, 6 lines, active mode only. Each live injector declares its own axis, so this
 * states the split rather than inventing an override (D6). Must not contain "Optimizes:" —
 * `mode-packs.check.ts` asserts exactly one occurrence in an active-mode injection.
 */
const PRECEDENCE = [
	"Injector precedence, one owner per axis:",
	"- Prose form: caveman and Simplified Technical English. No verbose narration.",
	"- Solution size: ponytail. No speculative scope.",
	"- Phase, order, required artifact: this pack.",
	"- Tiebreak: a required artifact is something the user asked to keep, so ponytail's carve-out yields to it. Ponytail still governs how much code it costs.",
	"- Keep the framing to one line. Execute the task, do not narrate the mode.",
].join("\n");

/**
 * Pure. The whole injection policy:
 *   source.error set        -> undefined  (fail visible-but-inert, D7)
 *   state is { mode: null } -> undefined  (explicit stand-down, zero cost, D3)
 *   state is null           -> router + one enforcement line (unset: teach set_mode)
 *   state.mode is a ModeId  -> router + active line + pack + transitions + precedence
 */
export function buildInjection(
	source: PackSource,
	state: ModeState | null,
	enforcement: Enforcement,
): string | undefined {
	if (source.error) {
		return undefined;
	}

	const blocks: string[] = [
		`Mode router (source: ${join(source.skillDir, "SKILL.md")}):`,
		source.routerTable,
	];

	if (state === null) {
		blocks.push(ENFORCEMENT_LINES[enforcement] ?? ENFORCEMENT_LINES.remind);
		return blocks.join("\n\n");
	}

	const mode = state.mode;
	if (mode === null) {
		return undefined;
	}

	blocks.push(
		`Active mode: \`${mode}\` — bottleneck: "${state.bottleneck}" (committed via set_mode).`,
	);

	const pack = source.packs[mode];
	if (pack === undefined) {
		// A single renamed heading after a pin bump: a named gap beats silent no-guidance (D7).
		blocks.push(
			`The \`${mode}\` pack section is missing from ${join(source.skillDir, "references", "modes.md")}. Route from the table above and re-copy the vendored subtree.`,
		);
	} else {
		blocks.push(pack);
		const transition = source.transitions[mode];
		if (transition) {
			blocks.push(`Likely transition:\n${transition}`);
		}
	}

	blocks.push(PRECEDENCE);
	return blocks.join("\n\n");
}

/** One mode's verbatim pack text, or null. The seam phase 2's `packProvider` fills (risk r1). */
export function packFor(source: PackSource, mode: ModeId): string | null {
	if (source.error) {
		return null;
	}
	return source.packs[mode] ?? null;
}
