import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildInjection, loadPackSource, packFor } from "./mode-packs";
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

	// Config is read synchronously so `enabled: false` can mean "tool never
	// registered" rather than "registered no-op": registration only happens
	// during this factory call. /reload re-runs the factory, so a hand edit plus
	// /reload is the whole configuration workflow.
	const loaded = loadConfig();
	if (!loaded.config.enabled) {
		// The vendored skill stays registered above: disabling the router must not
		// un-ship phase 1's coverage.
		return;
	}

	const store = createModeStore(pi, loaded);
	pi.on("session_start", (_event, ctx) => store.restore(ctx));

	const source = loadPackSource(SKILL_DIR);
	if (source.error) {
		// Narrow to a local so the handler needs no non-null assertion on the readonly field.
		const loadError = source.error;
		pi.on("session_start", (_event, ctx) => ctx.ui.notify(loadError, "error"));
	}

	pi.registerTool(createSetModeTool(store, (mode) => packFor(source, mode)));

	pi.on("before_agent_start", (event) => {
		const addition = buildInjection(
			source,
			store.get(),
			store.config.enforcement,
		);
		return addition
			? { systemPrompt: `${event.systemPrompt}\n\n${addition}` }
			: undefined;
	});
}
