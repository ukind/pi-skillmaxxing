import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	buildInjection,
	gateDecision,
	loadPackSource,
	packFor,
	type PackSource,
} from "./mode-packs";
import { createModeStore, loadConfig } from "./mode-state";
import { createSetModeTool } from "./set-mode-tool";

/** This extension's own on-disk directory, resolved from the module URL. */
const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Vendored skill root, pinned at upstream commit `ae37d84505a10a23b1a7f5b236f32e8fa9beff80`.
 *
 * Names the skill root, not the `skills/` parent: `loadSkillsFromDirInternal` short-circuits on a
 * directory that holds `SKILL.md`, so exactly one skill registers and no directory walk happens.
 * Phases 2 and 3 read the vendored markdown through this export.
 */
export const SKILL_DIR = join(EXTENSION_DIR, "skills", "agent-skills-system");

export default function skillmaxxing(pi: ExtensionAPI): void {
	// The returned path must be absolute. `extendResources` funnels every path through
	// `normalizeExtensionPaths` into `resolveResourcePath`, whose whole body is
	// `resolvePath(p, this.cwd, { trim: true })`, so a relative value resolves against the
	// session cwd and breaks in every session not started from the extension directory.
	pi.on("resources_discover", () => ({ skillPaths: [SKILL_DIR] }));

	// Config is read synchronously so `/reload` stays the whole configuration workflow.
	// It gates the advisory layer only — the router text, the packs, and the fault notify.
	// `set_mode` and the gate register for every value: a disabled injector must not disable
	// the mode machinery, and `set_mode` is the only way out of the gate.
	const loaded = loadConfig();

	const store = createModeStore(pi, loaded);
	pi.on("session_start", (_event, ctx) => store.restore(ctx));

	// One user turn, one commit. A user message opens the turn; any `set_mode` call closes it.
	// `turn_start` is the wrong trigger: it fires once per model round (`agent-loop.js:109`),
	// so the flag would reset after every assistant round and re-block the whole turn.
	pi.on("message_start", (event) => {
		if (event.message.role === "user") {
			store.resetTurn();
		}
	});
	pi.on("tool_call", (event) => gateDecision(store.committed(), event.toolName));

	// The pack echo stays gated: `source` stays null while disabled, so a disabled
	// extension registers `set_mode` with no pack text.
	let source: PackSource | null = null;
	pi.registerTool(
		createSetModeTool(store, (mode) => (source === null ? null : packFor(source, mode))),
	);

	if (!loaded.config.enabled) {
		// The vendored skill stays registered above: disabling the router must not
		// un-ship phase 1's coverage.
		return;
	}

	source = loadPackSource(SKILL_DIR);
	const packSource = source;
	if (packSource.error) {
		// Narrow to a local so the handler needs no non-null assertion on the readonly field.
		const loadError = packSource.error;
		pi.on("session_start", (_event, ctx) => ctx.ui.notify(loadError, "error"));
	}

	pi.on("before_agent_start", (event) => {
		const addition = buildInjection(
			packSource,
			store.get(),
			store.config.enforcement,
		);
		return addition
			? { systemPrompt: `${event.systemPrompt}\n\n${addition}` }
			: undefined;
	});
}
