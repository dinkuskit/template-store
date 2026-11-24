import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

// Review receipts bind to the exact (base, head) the review saw. A push or a
// stale event payload must never let an older head's verdict stand for the
// current one, so the dispatch must re-request on every push, cancel the older
// review, and hand the receiver only the live PR tuple.
const workflow = readFileSync(new URL("../../.github/workflows/clawsweeper-dispatch.yml", import.meta.url), "utf8");
const inline = workflow.match(/python3 -I - <<'PYBIND'\n([\s\S]*?)\n          PYBIND/)[1]
	.split("\n").map((line) => line.slice(10)).join("\n");
const review = workflow.slice(workflow.indexOf("\n  review:\n"));
const base = "a".repeat(40);
const staleHead = "b".repeat(40);
const liveHead = "c".repeat(40);

// Run the actual workflow binder for a push event against an isolated GitHub
// API fixture. No credential, network access, or GitHub mutation is needed.
function bindPush({ apiBase = base, apiHead = liveHead } = {}) {
	const root = mkdtempSync(join(tmpdir(), "store-exact-head-"));
	try {
		writeFileSync(join(root, "event.json"), JSON.stringify({ action: "synchronize", pull_request: { number: 19, base: { sha: base }, head: { sha: staleHead } } }));
		writeFileSync(join(root, "api.json"), JSON.stringify({
			"repos/dinkuskit/template-store": { id: 1306882668, default_branch: "main" },
			"repos/dinkuskit/template-store/pulls/19": { state: "open", draft: false, user: { login: "author", type: "User" }, base: { repo: { id: 1306882668 }, ref: "main", sha: apiBase }, head: { sha: apiHead } },
		}));
		writeFileSync(join(root, "gh"), "#!/usr/bin/env python3\nimport json,os,sys\nprint(json.dumps(json.load(open(os.environ['API_FIXTURE']))[sys.argv[2]]))\n", { mode: 0o700 });
		const output = join(root, "output");
		writeFileSync(output, "");
		const result = spawnSync("python3", ["-I", "-c", inline], { encoding: "utf8", env: {
			PATH: `${root}:${process.env.PATH}`, API_FIXTURE: join(root, "api.json"),
			GITHUB_EVENT_PATH: join(root, "event.json"), GITHUB_OUTPUT: output,
			GITHUB_EVENT_NAME: "pull_request_target", TARGET_REPO: "dinkuskit/template-store", TARGET_ID: "1306882668", PR_NUMBER: "19", MANUAL_PUBLISH: "false",
		} });
		assert.ifError(result.error);
		return { status: result.status, stderr: result.stderr, outputs: Object.fromEntries(readFileSync(output, "utf8").trim().split("\n").filter(Boolean).map((line) => line.split("="))) };
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("every push re-requests review and cancels the older head's review", () => {
	const types = workflow.match(/pull_request_target:\n\s+types: \[([^\]]+)\]/)[1].split(/,\s*/);
	assert.ok(types.includes("synchronize"));
	assert.match(review, /\n    concurrency:\n      group: \$\{\{ github\.repository \}\}-clawsweeper-dispatch-\$\{\{ needs\.bind\.outputs\.pr_number \}\}\n      cancel-in-progress: true\n/);
});

test("the receiver gets only the bound live tuple from an immutable rail", () => {
	assert.match(review, /\n    uses: dinkuskit\/clawsweeper\/\.github\/workflows\/[\w.-]+\.ya?ml@[0-9a-f]{40}\n/);
	assert.match(review, /\n      expected_base_sha: \$\{\{ needs\.bind\.outputs\.base_sha \}\}\n/);
	assert.match(review, /\n      expected_head_sha: \$\{\{ needs\.bind\.outputs\.head_sha \}\}\n/);
	assert.doesNotMatch(workflow, /github\.event\.pull_request\.(?:base|head)\.sha|github\.sha\b/);
});

test("the binder binds the live PR head, not the event payload's older head", () => {
	const r = bindPush();
	assert.equal(r.status, 0, r.stderr);
	assert.equal(r.outputs.requested, "true");
	assert.equal(r.outputs.base_sha, base);
	assert.equal(r.outputs.head_sha, liveHead);
});

test("the binder fails closed on a malformed base or head", () => {
	for (const tuple of [{ apiHead: "not-a-sha" }, { apiBase: "A".repeat(40) }, { apiHead: liveHead.slice(1) }]) {
		const r = bindPush(tuple);
		assert.notEqual(r.status, 0);
		assert.match(r.stderr, /Invalid source tuple/);
		assert.equal(r.outputs.requested, undefined);
	}
});
