import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/clawsweeper-dispatch.yml", import.meta.url), "utf8");
const inline = workflow.match(/python3 -I - <<'PYBIND'\n([\s\S]*?)\n          PYBIND/)[1]
	.split("\n").map((line) => line.slice(10)).join("\n");
const base = "a".repeat(40);
const head = "b".repeat(40);

// Exercise the actual workflow binder against an isolated GitHub API fixture.
// No credential, network access, or GitHub mutation is needed.
function bind({ command = "re-run", actor = "author", association = "CONTRIBUTOR", type = "User", kind = "issue_comment", draft = false, defaultHead = base } = {}) {
	const root = mkdtempSync(join(tmpdir(), "store-spark-bind-"));
	try {
		writeFileSync(join(root, "event.json"), JSON.stringify({ action: "created", issue: { pull_request: {} }, comment: { body: `@clawsweeper ${command}`, author_association: association, user: { login: actor, type } } }));
		writeFileSync(join(root, "api.json"), JSON.stringify({
			"repos/dinkuskit/template-store": { id: 1306882668, default_branch: "main" },
			"repos/dinkuskit/template-store/pulls/19": { state: "open", draft, user: { login: "author" }, base: { repo: { id: 1306882668 }, ref: "main", sha: base }, head: { sha: head } },
			"repos/dinkuskit/template-store/git/ref/heads/main": { object: { sha: defaultHead } },
		}));
		writeFileSync(join(root, "gh"), "#!/usr/bin/env python3\nimport json,os,sys\nprint(json.dumps(json.load(open(os.environ['API_FIXTURE']))[sys.argv[2]]))\n", { mode: 0o700 });
		const output = join(root, "output");
		writeFileSync(output, "");
		const result = spawnSync("python3", ["-I", "-c", inline], { encoding: "utf8", env: {
			PATH: `${root}:${process.env.PATH}`, API_FIXTURE: join(root, "api.json"),
			GITHUB_EVENT_PATH: join(root, "event.json"), GITHUB_OUTPUT: output,
			GITHUB_EVENT_NAME: kind, TARGET_REPO: "dinkuskit/template-store", TARGET_ID: "1306882668", PR_NUMBER: "19", MANUAL_PUBLISH: "false",
		} });
		assert.ifError(result.error);
		return { status: result.status, stderr: result.stderr, outputs: Object.fromEntries(readFileSync(output, "utf8").trim().split("\n").filter(Boolean).map((line) => line.split("="))) };
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("actual Spark binder admits exact author rerun aliases without publication", () => {
	const jobGate = workflow.slice(workflow.indexOf("jobs:"), workflow.indexOf("runs-on:"));
	assert.doesNotMatch(jobGate, /author_association/);
	for (const command of ["re-run", "re-review"]) {
		const r = bind({ command });
		assert.equal(r.status, 0, r.stderr);
		assert.deepEqual(r.outputs, { requested: "true", pr_number: "19", base_sha: base, head_sha: head, publish: "false" });
	}
});

test("Spark binder preserves maintainer publication and rejects unrelated or ambiguous comments", () => {
	assert.equal(bind({ command: "review", actor: "maintainer", association: "OWNER" }).outputs.publish, "true");
	for (const options of [{ actor: "unrelated" }, { command: "review" }, { type: "Bot" }, { command: "re-run\n@clawsweeper re-review" }, { draft: true }]) {
		const r = bind(options);
		assert.equal(r.status, 0, r.stderr);
		assert.deepEqual(r.outputs, { requested: "false" });
	}
});

test("manual Spark admission remains nonpublishing and rejects a moved base", () => {
	assert.equal(bind({ kind: "workflow_dispatch" }).outputs.publish, "false");
	const r = bind({ defaultHead: "c".repeat(40) });
	assert.notEqual(r.status, 0);
	assert.match(r.stderr, /Base moved during admission/);
});
