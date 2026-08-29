/**
 * Vendor integrity self-check for the pinned `agent-skills-system` copy.
 *
 * Run: `node extensions/skillmaxxing/vendor.check.ts`
 *
 * Imports nothing but `node:*`, so Node's native type stripping runs it with no build step and no
 * dependency install. Every assertion throws; exit 0 is the only pass. This is the file phases 2
 * and 3 rest on, so it also asserts the headings they slice against.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = join(EXTENSION_DIR, "skills", "agent-skills-system");

/** The pin every byte size below was measured at. Bump only with a fresh copy. */
const PIN = "ae37d84505a10a23b1a7f5b236f32e8fa9beff80";

/**
 * Byte size of every vendored file at the pin. A reflow, a formatter pass, or a CRLF conversion
 * during the copy changes a size and fails here.
 */
const EXPECTED_SIZES: Record<string, number> = {
	"SKILL.md": 5666,
	VERSION: 6,
	"agents/openai.yaml": 297,
	"references/context-state.md": 1563,
	"references/engineering-loops.md": 2460,
	"references/long-horizon.md": 1645,
	"references/modes.md": 5255,
	"references/security-autonomy.md": 1917,
	"references/tool-design.md": 1372,
	"references/verification.md": 1549,
};

/** The seven reference files. Phase 3 slices its packs out of `modes.md`. */
const REFERENCE_FILES = [
	"context-state.md",
	"engineering-loops.md",
	"long-horizon.md",
	"modes.md",
	"security-autonomy.md",
	"tool-design.md",
	"verification.md",
];

/** Authority for phase 2's `MODE_IDS`. Set-equality is asserted against `modes.md` below. */
const MODE_IDS = [
	"karpathy_mode",
	"rauch_mode",
	"levels_mode",
	"swyx_mode",
	"theo_mode",
	"amjad_mode",
];

/** Files that must never appear under the vendored tree. */
const FORBIDDEN_NAMES = [".gitignore", ".ignore", ".fdignore", "AGENTS.md"];

/** Byte size of the upstream repo-root loader stub, which must never be vendored as `SKILL.md`. */
const STUB_SIZE = 793;

/** Every file under `dir`, as slash-separated paths relative to `dir`. */
function walk(dir: string, prefix = ""): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			found.push(...walk(join(dir, entry.name), rel));
		} else {
			found.push(rel);
		}
	}
	return found.sort();
}

const context = `vendored tree ${SKILL_DIR} at pin ${PIN}`;

// 1. Inventory: exactly the 10 pinned files, in the expected layout.
const actual = walk(SKILL_DIR);
const expected = Object.keys(EXPECTED_SIZES).sort();
assert.deepEqual(
	actual,
	expected,
	`${context}: inventory mismatch\n  expected: ${expected.join(", ")}\n  actual:   ${actual.join(", ")}`,
);

// 2. Byte sizes: the copy is byte-identical to the pin.
for (const [rel, size] of Object.entries(EXPECTED_SIZES)) {
	const bytes = statSync(join(SKILL_DIR, rel)).size;
	assert.equal(bytes, size, `${context}: ${rel} is ${bytes} B, expected ${size} B`);
}

// 3. No ignore file and no `AGENTS.md` anywhere under the tree. An ignore file inside the scanned
//    directory would be applied by `addIgnoreRules` and could exclude `SKILL.md` from its own
//    discovery; a vendored `AGENTS.md` would be collected as project context in every prompt.
for (const rel of actual) {
	const base = rel.split("/").pop() ?? rel;
	assert.ok(!FORBIDDEN_NAMES.includes(base), `${context}: forbidden file vendored: ${rel}`);
}

// 4. `SKILL.md` is the canonical body, not the 793 B repo-root loader stub, and carries the three
//    headings the extension and its docs rely on.
const skillPath = join(SKILL_DIR, "SKILL.md");
const skillBytes = statSync(skillPath).size;
assert.notEqual(skillBytes, STUB_SIZE, `${context}: SKILL.md is the ${STUB_SIZE} B loader stub`);
const skill = readFileSync(skillPath, "utf8");
for (const heading of ["## Delegation Gate", "## Route The Task", "## Improve The Harness"]) {
	assert.ok(skill.includes(heading), `${context}: SKILL.md is missing heading ${heading}`);
}
assert.ok(
	/^name:\s*agent-skills-system$/m.test(skill),
	`${context}: SKILL.md frontmatter does not declare name: agent-skills-system`,
);
assert.ok(
	!skill.includes("disable-model-invocation"),
	`${context}: SKILL.md declares disable-model-invocation, which hides it from <available_skills>`,
);

// 5. `VERSION` is the staleness anchor.
const version = readFileSync(join(SKILL_DIR, "VERSION"), "utf8").trim();
assert.equal(version, "0.3.0", `${context}: VERSION reads ${JSON.stringify(version)}, expected 0.3.0`);

// 6. `references/` holds exactly the seven named files.
const references = readdirSync(join(SKILL_DIR, "references")).sort();
assert.deepEqual(
	references,
	[...REFERENCE_FILES].sort(),
	`${context}: references/ holds ${references.join(", ")}`,
);

// 7. `modes.md` carries exactly the six mode headings phase 2's MODE_IDS mirrors, plus the
//    transitions section phase 3 slices against.
const modes = readFileSync(join(SKILL_DIR, "references", "modes.md"), "utf8");
const headings = [...modes.matchAll(/^## `([a-z_]+)`$/gm)].map((match) => match[1]);
assert.deepEqual(
	[...headings].sort(),
	[...MODE_IDS].sort(),
	`${context}: modes.md declares ${headings.join(", ")}`,
);
assert.ok(
	modes.includes("## Common Transitions"),
	`${context}: modes.md is missing the ## Common Transitions heading`,
);

console.log(`vendor.check: OK — ${actual.length} files, pin ${PIN}, VERSION ${version}`);
