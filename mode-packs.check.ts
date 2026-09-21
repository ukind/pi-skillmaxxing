/**
 * Self-check for the mode-pack injector. Read-only against the vendored tree.
 * Run: node extensions/skillmaxxing/mode-packs.check.ts
 */
import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	ROUTER_HEADING,
	TRANSITIONS_HEADING,
	buildInjection,
	extractSection,
	gateDecision,
	loadPackSource,
	packFor,
	GATE_REASON,
	type PackSource,
} from "./mode-packs.ts";
import { MODE_IDS, type ModeId } from "./mode-state.ts";

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = join(EXTENSION_DIR, "skills", "agent-skills-system");
const SKILL_MD = join(SKILL_DIR, "SKILL.md");
const MODES_MD = join(SKILL_DIR, "references", "modes.md");

const skillMd = readFileSync(SKILL_MD, "utf8");
const modesMd = readFileSync(MODES_MD, "utf8");
const source = loadPackSource(SKILL_DIR);
assert.equal(
	source.error,
	undefined,
	"the vendored tree must load without a fault",
);

// --- router table -----------------------------------------------------------
const router = extractSection(skillMd, ROUTER_HEADING);
assert.notEqual(router, null, `${ROUTER_HEADING} must exist in SKILL.md`);
assert.ok(skillMd.includes(router as string), "router section must be verbatim");
assert.ok(
	(router as string).split("\n").length <= 20,
	"router section must stay compact (<= 20 lines)",
);
assert.equal(
	source.routerTable,
	router,
	"loadPackSource must use extractSection",
);
for (const id of MODE_IDS) {
	assert.ok((router as string).includes(id), `router table must name ${id}`);
}
assert.ok(
	(router as string).includes("Do not trigger this skill merely because"),
	"router section must carry the upstream negative-trigger guard",
);

// --- packs ------------------------------------------------------------------
assert.deepEqual(
	Object.keys(source.packs).slice().sort(),
	MODE_IDS.slice().sort(),
	"pack keys sliced from modes.md must equal MODE_IDS",
);
for (const id of MODE_IDS) {
	const pack = source.packs[id] as string;
	assert.ok(
		modesMd.includes(pack),
		`${id} pack must be a verbatim substring of modes.md`,
	);
	assert.ok(
		pack.startsWith(`## \`${id}\``),
		`${id} pack must start at its own heading`,
	);
	assert.ok(pack.includes("First move:"), `${id} pack must carry First move:`);
	assert.ok(
		pack.includes("Switch signal:"),
		`${id} pack must carry Switch signal:`,
	);
	assert.equal(
		packFor(source, id),
		pack,
		`packFor must return ${id}'s verbatim section`,
	);
}

// --- transitions ------------------------------------------------------------
assert.notEqual(
	extractSection(modesMd, TRANSITIONS_HEADING),
	null,
	"transitions heading",
);
assert.equal(
	source.transitions.rauch_mode,
	"",
	"rauch_mode is a sink: no outbound transition",
);
assert.ok(
	(source.transitions.theo_mode as string).includes(
		"`theo_mode -> rauch_mode`",
	),
	"theo_mode must carry its outbound transition line",
);
for (const id of MODE_IDS) {
	const line = source.transitions[id] as string;
	assert.ok(
		line === "" || line.startsWith(`- \`${id} -> `),
		`${id} owns only its own lines`,
	);
}

// --- injection states -------------------------------------------------------
const unset = buildInjection(source, null, "remind");
assert.ok(unset !== undefined, "the unset state must inject the router block");
assert.ok(unset.includes("set_mode"), "the unset state must teach set_mode");
assert.ok(
	!unset.includes("Optimizes:"),
	"the unset state must leak no pack text",
);
assert.ok(
	unset.includes(source.routerTable),
	"the unset state must carry the router verbatim",
);
const blockUnset = buildInjection(source, null, "block") as string;
assert.ok(
	blockUnset.includes("Do not start"),
	"block is the imperative variant",
);
assert.ok(
	!blockUnset.includes("exempt"),
	"block must drop the routine-edit carve-out: the gate denies for real (FR3)",
);
assert.notEqual(blockUnset, unset, "enforcement must shape the unset line");
// Both variants, not just the default: `block` is the longer line, so it is the real ceiling.
for (const [label, text] of [
	["remind", unset],
	["block", blockUnset],
] as const) {
	assert.ok(
		Buffer.byteLength(text, "utf8") < 1536,
		`the unset/${label} addition must stay under 1.5 KB (measured ${Buffer.byteLength(text, "utf8")} B)`,
	);
}

assert.equal(
	buildInjection(source, { mode: null, bottleneck: "x" }, "remind"),
	undefined,
	"an explicit stand-down is the zero-cost state",
);

const active = buildInjection(
	source,
	{ mode: "theo_mode", bottleneck: "typed billing" },
	"remind",
);
assert.ok(active !== undefined, "a committed mode must inject");
assert.ok(
	active.includes(source.packs.theo_mode as string),
	"active state carries the pack",
);
assert.ok(
	active.includes("`theo_mode -> rauch_mode`"),
	"active state carries the transition",
);
assert.ok(
	active.includes('bottleneck: "typed billing"'),
	"active state names the bottleneck",
);
assert.ok(
	active.includes("Injector precedence"),
	"active state carries the precedence block",
);
assert.ok(active.includes("ponytail"), "precedence must name ponytail");
assert.ok(active.includes("caveman"), "precedence must name caveman");
assert.equal(
	active.split("Optimizes:").length - 1,
	1,
	"exactly one mode's pack may be injected",
);
// Every mode, not only theo_mode: amjad_mode and swyx_mode carry an extra upstream prose
// line, so they are the real ceiling. Measured with a short bottleneck — the committed
// bottleneck is unbounded user text and the header line embeds SKILL_DIR, so both add bytes.
for (const id of MODE_IDS) {
	const text = buildInjection(
		source,
		{ mode: id, bottleneck: "x" },
		"remind",
	) as string;
	assert.ok(
		Buffer.byteLength(text, "utf8") < 3072,
		`the ${id} addition must stay under 3 KB (measured ${Buffer.byteLength(text, "utf8")} B)`,
	);
}
assert.equal(
	buildInjection(source, { mode: "theo_mode", bottleneck: "typed billing" }, "remind"),
	active,
	"buildInjection must be pure",
);
assert.ok(
	!buildInjection(
		source,
		{ mode: "karpathy_mode", bottleneck: "b" },
		"remind",
	)?.includes("Sacrifices: theoretical purity"),
	"no other mode's pack may leak",
);

// --- load faults ------------------------------------------------------------
const faulted: PackSource = { ...source, error: "boom" };
for (const state of [
	null,
	{ mode: null, bottleneck: "x" },
	{ mode: "theo_mode" as ModeId, bottleneck: "x" },
]) {
	assert.equal(
		buildInjection(faulted, state, "remind"),
		undefined,
		"a load fault injects nothing in every state",
	);
}
assert.equal(
	packFor(faulted, "theo_mode"),
	null,
	"packFor must respect a load fault",
);

const missing = loadPackSource(join(EXTENSION_DIR, "does-not-exist"));
assert.ok(
	missing.error?.includes("SKILL.md"),
	"an unreadable file is a named load fault",
);
assert.equal(
	buildInjection(missing, null, "remind"),
	undefined,
	"and injects nothing",
);

const scratch = mkdtempSync(join(tmpdir(), "skillmaxxing-check-"));
try {
	// Renamed router heading -> all-or-nothing load fault.
	const renamed = join(scratch, "renamed");
	mkdirSync(join(renamed, "references"), { recursive: true });
	writeFileSync(
		join(renamed, "SKILL.md"),
		skillMd.replace(ROUTER_HEADING, "## Routing"),
		"utf8",
	);
	writeFileSync(join(renamed, "references", "modes.md"), modesMd, "utf8");
	const renamedSource = loadPackSource(renamed);
	assert.ok(
		renamedSource.error?.includes(ROUTER_HEADING),
		"a missing router heading faults",
	);
	assert.equal(
		buildInjection(renamedSource, null, "remind"),
		undefined,
		"and injects nothing",
	);

	// One renamed pack heading -> local degrade, router still ships.
	const dropped = join(scratch, "dropped");
	mkdirSync(join(dropped, "references"), { recursive: true });
	writeFileSync(join(dropped, "SKILL.md"), skillMd, "utf8");
	writeFileSync(
		join(dropped, "references", "modes.md"),
		modesMd.replace("## `theo_mode`", "## `theo-mode`"),
		"utf8",
	);
	const droppedSource = loadPackSource(dropped);
	assert.equal(
		droppedSource.error,
		undefined,
		"one missing pack is not a load fault",
	);
	const degraded = buildInjection(
		droppedSource,
		{ mode: "theo_mode", bottleneck: "x" },
		"remind",
	);
	assert.ok(degraded !== undefined, "a committed mode still gets the router block");
	assert.ok(
		degraded.includes(droppedSource.routerTable),
		"router block still ships",
	);
	// Scope to the gap block: the verbatim router table already contains both "theo_mode" and
	// the literal link "references/modes.md", so a whole-string assertion passes vacuously.
	const gap = degraded
		.split("\n\n")
		.find((block) => block.includes("pack section is missing"));
	assert.ok(gap !== undefined, "the gap must be one named block, not silence");
	assert.ok(gap.includes("theo_mode"), "the gap must name the missing section");
	assert.ok(
		gap.includes(join("references", "modes.md")),
		"the gap must name the file, with the platform separator",
	);
	assert.ok(!degraded.includes("Optimizes:"), "no substitute pack is invented");
} finally {
	rmSync(scratch, { recursive: true, force: true });
}

const widest = MODE_IDS.map((id) =>
	Buffer.byteLength(
		buildInjection(source, { mode: id, bottleneck: "x" }, "remind") as string,
	),
).reduce((a, b) => Math.max(a, b), 0);
// --- new gate section: insert before the byte-size console.log at the file end ---
// --- gate predicate ---------------------------------------------------------
assert.ok(
	GATE_REASON.includes("set_mode"),
	"the block reason must name the fix",
);
assert.ok(
	GATE_REASON.includes('"none"'),
	'the block reason must state that mode "none" is allowed',
);
assert.ok(
	GATE_REASON.includes("retry"),
	"the block reason must state the retry recovery for parallel batches",
);
assert.ok(
	!GATE_REASON.includes("exempt"),
	"the block reason must carry no routine-edit carve-out (FR3)",
);
for (const tool of ["bash", "read", "edit", "write", "todo"]) {
	assert.deepEqual(
		gateDecision(false, tool),
		{ block: true, reason: GATE_REASON },
		`an uncommitted turn must block ${tool}`,
	);
}
assert.equal(
	gateDecision(false, "set_mode"),
	undefined,
	"set_mode must never be blocked (deadlock-free)",
);
assert.equal(
	gateDecision(false, "fabric_exec"),
	undefined,
	"the transport must never be blocked: set_mode is reachable only inside its program",
);
assert.equal(
	gateDecision(true, "bash"),
	undefined,
	"a committed turn passes every tool",
);
assert.equal(
	gateDecision(true, "set_mode"),
	undefined,
	"a committed turn passes set_mode too",
);

console.log(
	`mode-packs.check.ts OK — router ${Buffer.byteLength(source.routerTable)} B, unset ${Buffer.byteLength(unset)}/${Buffer.byteLength(blockUnset)} B, widest pack ${widest} B`,
);
