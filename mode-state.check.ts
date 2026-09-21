// Self-check for mode-state.ts. Run: node extensions/skillmaxxing/mode-state.check.ts
// Assert-based, exit 0 is the only pass. Imports node builtins and ./mode-state.ts
// only (with the extension, which Node ESM requires) — no typebox, no pi value import.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createModeStore,
	DEFAULT_CONFIG,
	loadConfig,
	MODE_ENTRY_TYPE,
	MODE_IDS,
	readModeFromEntries,
} from "./mode-state.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODES_MD = join(
	HERE,
	"skills",
	"agent-skills-system",
	"references",
	"modes.md",
);

// --- 1. MODE_IDS is set-equal to the vendored references/modes.md headings ----
const markdown = readFileSync(MODES_MD, "utf8");
const headings = [...markdown.matchAll(/^##\s+`([a-z0-9_]+)`\s*$/gm)].map(
	(m) => m[1],
);
assert.deepEqual(
	[...headings].sort(),
	[...MODE_IDS].sort(),
	`MODE_IDS does not match the mode headings in ${MODES_MD}: ${headings.join(", ")}`,
);

// --- 2. loadConfig: missing file, malformed JSON, field clamping -------------
const scratch = mkdtempSync(join(tmpdir(), "skillmaxxing-check-"));
try {
	const missing = loadConfig(join(scratch, "absent.json"));
	assert.deepEqual(missing.config, DEFAULT_CONFIG);
	assert.equal(missing.error, undefined, "a missing file is not an error");

	const badPath = join(scratch, "malformed.json");
	writeFileSync(badPath, '{ "enabled": true, }', "utf8");
	const bad = loadConfig(badPath);
	assert.deepEqual(bad.config, DEFAULT_CONFIG);
	assert.ok(
		typeof bad.error === "string" && bad.error.length > 0,
		"malformed JSON must set error",
	);
	assert.ok(bad.error.includes("malformed.json"), "error must name the file");

	const clampPath = join(scratch, "clamp.json");
	writeFileSync(
		clampPath,
		'{"enabled":"yes","enforcement":"loud","defaultMode":"nope_mode"}',
		"utf8",
	);
	const clamped = loadConfig(clampPath);
	assert.deepEqual(clamped.config, DEFAULT_CONFIG, "all three fields clamp");
	assert.equal(clamped.error, undefined, "clamping is not a parse error");

	const goodPath = join(scratch, "good.json");
	writeFileSync(
		goodPath,
		'{"enabled":false,"enforcement":"block","defaultMode":"theo_mode"}',
		"utf8",
	);
	assert.deepEqual(loadConfig(goodPath).config, {
		enabled: false,
		enforcement: "block",
		defaultMode: "theo_mode",
	});
} finally {
	rmSync(scratch, { recursive: true, force: true });
}

// --- 3. readModeFromEntries: none / last-wins / stand-down / corrupt ---------
let seq = 0;
const entry = (data: unknown, customType: string = MODE_ENTRY_TYPE) => ({
	type: "custom" as const,
	id: `e${++seq}`,
	parentId: null,
	timestamp: new Date(0).toISOString(),
	customType,
	data,
});

assert.equal(readModeFromEntries([]), null, "no entry means null");
assert.equal(
	readModeFromEntries([
		entry({ mode: "theo_mode", bottleneck: "x" }, "ste-mode"),
	]),
	null,
	"another extension's customType is ignored",
);
assert.deepEqual(
	readModeFromEntries([
		entry({ mode: "theo_mode", bottleneck: "typed billing boundary" }),
		entry({ mode: "rauch_mode", bottleneck: "signup trust" }),
	]),
	{ mode: "rauch_mode", bottleneck: "signup trust" },
	"last valid entry wins",
);
assert.deepEqual(
	readModeFromEntries([
		entry({ mode: "theo_mode", bottleneck: "typed billing boundary" }),
		entry({ mode: null, bottleneck: "routine edit" }),
	]),
	{ mode: null, bottleneck: "routine edit" },
	"a stand-down is a state, not an absence",
);
assert.deepEqual(
	readModeFromEntries([
		entry({ mode: "theo_mode", bottleneck: "typed billing boundary" }),
		entry({ mode: "nope_mode", bottleneck: "hand-edited" }),
		entry({ bottleneck: "no mode key" }),
	]),
	{ mode: "theo_mode", bottleneck: "typed billing boundary" },
	"entries with an unknown or absent mode are ignored",
);

// --- 4. createModeStore: dedupe, previous, restore precedence ----------------
const appended: { customType: string; data: unknown }[] = [];
const notifications: string[] = [];
const fakePi = {
	appendEntry: (customType: string, data?: unknown) => {
		appended.push({ customType, data });
	},
} as unknown as Parameters<typeof createModeStore>[0];
const ctxWith = (entries: ReturnType<typeof entry>[]) =>
	({
		sessionManager: { getBranch: () => entries },
		ui: { notify: (message: string) => notifications.push(message) },
	}) as unknown as Parameters<ReturnType<typeof createModeStore>["restore"]>[0];

const store = createModeStore(fakePi, { config: { ...DEFAULT_CONFIG } });
assert.equal(store.get(), null);
assert.deepEqual(store.commit("theo_mode", "typed billing boundary"), {
	previous: null,
	wrote: true,
});
assert.deepEqual(store.commit("theo_mode", "typed billing boundary"), {
	previous: "theo_mode",
	wrote: false,
});
assert.equal(appended.length, 1, "an unchanged pair appends no second entry");
assert.deepEqual(store.commit("rauch_mode", "signup trust"), {
	previous: "theo_mode",
	wrote: true,
});
assert.equal(store.get()?.mode, "rauch_mode");
assert.deepEqual(appended.at(-1), {
	customType: MODE_ENTRY_TYPE,
	data: { mode: "rauch_mode", bottleneck: "signup trust" },
});

// restore from the branch: adopt, append nothing
appended.length = 0;
store.restore(ctxWith([entry({ mode: "levels_mode", bottleneck: "demand" })]));
assert.deepEqual(store.get(), { mode: "levels_mode", bottleneck: "demand" });
assert.equal(appended.length, 0, "a reload must not grow the session file");

// no entry plus a config default: adopt with exactly one append
appended.length = 0;
const defaulted = createModeStore(fakePi, {
	config: { ...DEFAULT_CONFIG, defaultMode: "levels_mode" },
});
defaulted.restore(ctxWith([]));
assert.deepEqual(defaulted.get(), {
	mode: "levels_mode",
	bottleneck: "(config default)",
});
assert.deepEqual(appended, [
	{
		customType: MODE_ENTRY_TYPE,
		data: { mode: "levels_mode", bottleneck: "(config default)" },
	},
]);

// an explicit stand-down beats the config default
appended.length = 0;
const stoodDown = createModeStore(fakePi, {
	config: { ...DEFAULT_CONFIG, defaultMode: "levels_mode" },
});
stoodDown.restore(ctxWith([entry({ mode: null, bottleneck: "routine edit" })]));
assert.equal(stoodDown.get()?.mode, null);
assert.equal(appended.length, 0);

// a config error notifies exactly once, and names the file
const faulty = createModeStore(fakePi, {
	config: { ...DEFAULT_CONFIG },
	error: "/x/skillmaxxing.json is not valid JSON",
});
faulty.restore(ctxWith([]));
faulty.restore(ctxWith([]));
assert.equal(notifications.length, 1, "exactly one config-error notification");
assert.ok(notifications[0].includes("skillmaxxing.json"));

// --- 5. createModeStore: per-turn commit flag (gate state) -------------------
const restoredGate = createModeStore(fakePi, { config: { ...DEFAULT_CONFIG } });
restoredGate.restore(ctxWith([entry({ mode: "theo_mode", bottleneck: "x" })]));
assert.deepEqual(restoredGate.get(), { mode: "theo_mode", bottleneck: "x" });
assert.equal(restoredGate.committed(), false, "session restore must not satisfy the gate");

// A config default commits inside restore, so the clear must come last (FR2).
const defaultGate = createModeStore(fakePi, {
	config: { ...DEFAULT_CONFIG, defaultMode: "levels_mode" },
});
defaultGate.restore(ctxWith([]));
assert.deepEqual(defaultGate.get(), {
	mode: "levels_mode",
	bottleneck: "(config default)",
});
assert.equal(defaultGate.committed(), false, "a config default must not satisfy the gate");

const turnStore = createModeStore(fakePi, { config: { ...DEFAULT_CONFIG } });
assert.equal(turnStore.committed(), false, "a fresh store starts uncommitted");
assert.deepEqual(turnStore.commit(null, "routine edit"), {
	previous: null,
	wrote: true,
});
assert.equal(turnStore.committed(), true, "a stand-down commit satisfies the turn");

turnStore.resetTurn();
assert.equal(turnStore.committed(), false, "a new user turn clears the flag");
assert.deepEqual(turnStore.get(), { mode: null, bottleneck: "routine edit" });
assert.deepEqual(turnStore.commit(null, "routine edit"), {
	previous: null,
	wrote: false,
});
assert.equal(turnStore.committed(), true, "a deduped commit still satisfies the turn");
assert.deepEqual(turnStore.get(), { mode: null, bottleneck: "routine edit" });

console.log("mode-state.check.ts: all assertions passed");
