import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";

/** The six upstream modes. Asserted set-equal to the vendored references/modes.md headings. */
export type ModeId =
	| "karpathy_mode"
	| "rauch_mode"
	| "levels_mode"
	| "swyx_mode"
	| "theo_mode"
	| "amjad_mode";

export const MODE_IDS = [
	"karpathy_mode",
	"rauch_mode",
	"levels_mode",
	"swyx_mode",
	"theo_mode",
	"amjad_mode",
] as const satisfies readonly ModeId[];

/** Domain of the config's `enforcement` field. Phase 3 interprets it; nothing here does. */
export type Enforcement = "remind" | "block";

const ENFORCEMENTS = ["remind", "block"] as const satisfies readonly Enforcement[];

export const MODE_ENTRY_TYPE = "skillmaxxing-mode";

export const CONFIG_PATH: string = join(
	homedir(),
	".pi",
	"agent",
	"skillmaxxing.json",
);

/** `mode: null` is an explicit stand-down, not "unset". */
export interface ModeState {
	mode: ModeId | null;
	bottleneck: string;
}

export interface SkillmaxxingConfig {
	/** Gates the mode machinery (tool + phase 3 injector). The vendored skill ships regardless. */
	enabled: boolean;
	/** Carried here, interpreted by phase 3. */
	enforcement: Enforcement;
	/** Applied only when the live branch holds no mode entry. */
	defaultMode: ModeId | null;
}

export const DEFAULT_CONFIG: SkillmaxxingConfig = {
	enabled: true,
	enforcement: "remind",
	defaultMode: null,
};

export interface LoadedConfig {
	config: SkillmaxxingConfig;
	/** Set only when the file existed and could not be used. */
	error?: string;
}

export function isModeId(value: unknown): value is ModeId {
	return (
		typeof value === "string" && (MODE_IDS as readonly string[]).includes(value)
	);
}

function isEnforcement(value: unknown): value is Enforcement {
	return (
		typeof value === "string" &&
		(ENFORCEMENTS as readonly string[]).includes(value)
	);
}

/**
 * Sync (readFileSync) on purpose: `enabled: false` must mean the tool is never
 * registered, and registration happens during the factory call.
 * Never throws. Every field is clamped against its own domain.
 */
export function loadConfig(path: string = CONFIG_PATH): LoadedConfig {
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return { config: { ...DEFAULT_CONFIG } };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (cause) {
		return {
			config: { ...DEFAULT_CONFIG },
			error: `${path} is not valid JSON (${(cause as Error).message}). Defaults are in force.`,
		};
	}

	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return {
			config: { ...DEFAULT_CONFIG },
			error: `${path} must hold a JSON object. Defaults are in force.`,
		};
	}

	const fields = parsed as Record<string, unknown>;
	return {
		config: {
			enabled:
				typeof fields.enabled === "boolean"
					? fields.enabled
					: DEFAULT_CONFIG.enabled,
			enforcement: isEnforcement(fields.enforcement)
				? fields.enforcement
				: DEFAULT_CONFIG.enforcement,
			defaultMode: isModeId(fields.defaultMode)
				? fields.defaultMode
				: DEFAULT_CONFIG.defaultMode,
		},
	};
}

/**
 * Pure. Pass `sessionManager.getBranch()` — the live leaf-to-root path, not
 * `getEntries()` (the call at `extensions/simple-english/index.ts:472`), which
 * also returns abandoned branches and can resurrect a mode after a fork.
 * Last valid entry wins. Entries whose `mode` is neither null nor a known id are
 * ignored. A `null` return means "no entry on this branch", which is not a
 * stand-down.
 */
export function readModeFromEntries(
	entries: readonly SessionEntry[],
): ModeState | null {
	let state: ModeState | null = null;
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== MODE_ENTRY_TYPE) {
			continue;
		}
		const data = (entry.data ?? {}) as { mode?: unknown; bottleneck?: unknown };
		const mode =
			data.mode === null ? null : isModeId(data.mode) ? data.mode : undefined;
		if (mode === undefined) {
			continue;
		}
		state = {
			mode,
			bottleneck: typeof data.bottleneck === "string" ? data.bottleneck : "",
		};
	}
	return state;
}

export interface ModeStore {
	readonly config: SkillmaxxingConfig;
	/** Active state, or null when no mode is committed. Phase 3 reads this. */
	get(): ModeState | null;
	/** Replace the active mode. Appends one session entry unless the pair is unchanged. */
	commit(
		mode: ModeId | null,
		bottleneck: string,
	): { previous: ModeId | null; wrote: boolean };
	/** session_start: restore from the branch, else apply config.defaultMode. */
	restore(ctx: Pick<ExtensionContext, "sessionManager" | "ui">): void;
}

export function createModeStore(
	pi: Pick<ExtensionAPI, "appendEntry">,
	loaded: LoadedConfig,
): ModeStore {
	let state: ModeState | null = null;
	let notifiedConfigError = false;

	function commit(
		mode: ModeId | null,
		bottleneck: string,
	): { previous: ModeId | null; wrote: boolean } {
		const previous = state?.mode ?? null;
		if (state !== null && state.mode === mode && state.bottleneck === bottleneck) {
			return { previous, wrote: false };
		}
		state = { mode, bottleneck };
		pi.appendEntry(MODE_ENTRY_TYPE, { mode, bottleneck });
		return { previous, wrote: true };
	}

	return {
		config: loaded.config,
		get: () => state,
		commit,
		restore(ctx) {
			if (loaded.error !== undefined && !notifiedConfigError) {
				notifiedConfigError = true;
				ctx.ui.notify(loaded.error, "error");
			}
			// A state on the live branch is adopted with no append: a /reload must
			// not grow the session file. An explicit stand-down is such a state, so
			// it beats config.defaultMode. Reassigning unconditionally also clears a
			// previous session's mode on a "new" / "resume" / "fork" session_start.
			state = readModeFromEntries(ctx.sessionManager.getBranch());
			if (state !== null) {
				return;
			}
			if (loaded.config.defaultMode !== null) {
				// Recorded exactly like a model commit — the
				// `extensions/simple-english/index.ts:482` precedent.
				commit(loaded.config.defaultMode, "(config default)");
			}
		},
	};
}
