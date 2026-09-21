import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { MODE_IDS, type ModeId, type ModeStore } from "./mode-state";

// Inline StringEnum — pi-ai is a nested transitive dep (inside pi-coding-agent),
// not resolvable from the extension directory at runtime. typebox is top-level.
// Mirrors pi-ai/dist/utils/typebox-helpers.ts exactly.
function StringEnum<T extends string>(
	values: readonly T[],
	options?: { description?: string },
) {
	return Type.Unsafe<T>({
		type: "string",
		enum: values,
		...(options?.description && { description: options.description }),
	});
}

const MODE_PARAM = [...MODE_IDS, "none"] as const;

export interface SetModeDetails {
	mode: ModeId | null;
	previous: ModeId | null;
}

/**
 * Declares no promptSnippet and no promptGuidelines: buildSystemPrompt returns
 * inside `if (customPrompt)` before the sections that render them, and this tree
 * has a live full-prompt override, so both would render nowhere today and would
 * start rendering silently the day the override is removed. All injected text
 * rides phase 3's before_agent_start return instead.
 *
 * `packProvider` is the phase 3 seam that closes the one-turn lag (risk r1).
 * Omitted, the result text is unchanged, so this phase ships standalone.
 */
export function createSetModeTool(
	store: ModeStore,
	packProvider?: (mode: ModeId) => string | null,
) {
	return defineTool({
		name: "set_mode",
		label: "Set Mode",
		description:
			"Commit to one execution mode for the current phase. Call before non-trivial work, " +
			"and again only when the bottleneck changes at a stable phase boundary. One mode is " +
			'active at a time; this replaces the previous one. Pass mode "none" to stand down.',
		parameters: Type.Object({
			mode: StringEnum(MODE_PARAM, {
				description:
					'The mode that owns the current bottleneck, or "none" to stand down.',
			}),
			bottleneck: Type.String({
				minLength: 3,
				description: "One sentence naming the bottleneck this mode owns.",
			}),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const next: ModeId | null = params.mode === "none" ? null : params.mode;
			const bottleneck = params.bottleneck.trim();
			const { previous, wrote } = store.commit(next, bottleneck);

			const lines: string[] = [];
			if (!wrote) {
				lines.push(
					next === null
						? `Already stood down. Bottleneck unchanged: ${bottleneck}`
						: `${next} is already active. Bottleneck unchanged: ${bottleneck}`,
				);
			} else if (next === null) {
				lines.push(`Mode stood down. Bottleneck: ${bottleneck}`);
			} else {
				lines.push(`${next} active. Bottleneck: ${bottleneck}`);
			}
			// Switch discipline (upstream SKILL.md, Mode Switching): name the mode
			// left behind and ask for its required artifact. A reminder, never a block.
			if (wrote && previous !== null && previous !== next) {
				lines.push(
					`Switched from ${previous}. Produce ${previous}'s required artifact before leaving it, or say why it is not needed.`,
				);
			}

			const pack =
				packProvider !== undefined && next !== null ? packProvider(next) : null;
			if (pack !== null && pack !== "") {
				lines.push("", pack);
			}

			const details: SetModeDetails = {
				mode: next,
				previous,
			};
			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details,
			};
		},
	});
}
