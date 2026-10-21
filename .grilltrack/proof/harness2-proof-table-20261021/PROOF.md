# Proof-table planning experiment

Agents could call for successful fixtures without defining independent expected values or a populated passing case. The new 173-word AGENTS appendix requires a compact acceptance-to-proof table so each material requirement names its source, independent expectation, populated positive case, adverse case, environment and planned evidence.

## Result

| Planning case | Original | Candidate | Independent manual result | Jev 1.13 |
| --- | ---: | ---: | --- | --- |
| Historic verifier task #36 | 92.5 | 100 | Candidate better | Candidate, confidence 0.61 |
| Held-out structured-data/policy/feed task #35 | 92 | 100 | Candidate better | Candidate, confidence 0.45 |

These are scores out of 100 under fixed rubrics, not product-success rates. Both comparisons found the targeted independent-oracle and populated-positive-proof gap in the original; the candidate filled it without a material environment, acceptance or authority regression. Review [training plans](training-original.md) and [candidate](training-candidate.md), [held-out original](holdout-original.md) and [candidate](holdout-candidate.md), plus the corresponding manual and Jev JSON records.

The frozen verifier rubric weights invocation/read-only reporting 15, crawl/canonical identity 20, product/legacy URLs 15, structured-data/built-ins 10, positive/adverse proof 15, environment 10, dependencies 10 and handoff 5. The other rubric weights Product JSON-LD 20, single-source policy 17, feed 15, positive/adverse proof 16, dependency validation 12, environment 12 and scope/questions 8. Ratings were 0/1/2, with independent expected facts and a populated passing case additionally required. Formatting alone earned no credit. Hard failures or material regressions could not be offset by a higher total.

## Execution and source identity

One full sequential Harness2 trial ran reference plus three improved solver plans, three improvement calls and reflection: 8 calls. Reflection returned NO_ENTRY. The held-out pair used 2 fixed calls and was not another refinement loop. It was withheld from this trial’s optimizer, but the same task appeared in an earlier study; it is not a new independent dataset. All 10 calls completed with isolation attestations. The original instructions stayed byte-identical; independent checks passed the candidate's generic-only and 180-word limits.

- Runner: [AI Shed fec8db4](https://github.com/saari-co/ai-shed/tree/fec8db471cf593702407283d982a90c8b6bf3681/harness2-replay), merged in [#45](https://github.com/saari-co/ai-shed/pull/45).
- Upstream Harness2 pin: 1cfe254e8d25b15f37048c3730134686abe60335.
- Training source: [Template Store0040061](https://github.com/dinkuskit/template-store/tree/0040061283f748b00d23a33a17b421ec01ba7e6f).
- Holdout source: [Template Store3a93df6](https://github.com/dinkuskit/template-store/tree/3a93df6ed3ad3dda94182ab0bdf795d360b5df7a), paired Commerce cbc636eab20ee7759107f3a10ddff776cebe7dd8.
- Source application preserves all pre-existing AGENTS.md bytes at3d234463ba6150d4a2701ccc564fbce329995bad and appends [the exact tested candidate](CANDIDATE.md). Hashes and result metadata are in [RESULT.json](RESULT.json).

The first training manual-judge attempt through Grok timed out after 300 seconds without returning a judgment. Its cleanup was confirmed; Cursor then evaluated the same anonymous packet. This failed attempt is preserved in the private run record and is not counted as a successful review. No extra Jev reruns were used.

## Scope and limits

This supports trying the instruction in this repository. It does not prove faster delivery, lower total token use, fewer owner interruptions, live-store correctness, or transfer to other repositories. Candidate plans were longer: 968 versus 725 words and 917 versus 755 words. Production behavior was not exercised by these planning comparisons. No global or installed instruction rollout is included. Repository checks and native review remain separate from this experiment.

Repository validation is separate from these planning results. The PR checks and source-bound closeout record carry its actual outcome; this experiment does not assert a passing repository suite. Raw admitted packets, runtime metadata and all attempts are retained in the operator's private proof run. Only public-source planning evidence is committed here.
