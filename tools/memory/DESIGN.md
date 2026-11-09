# Phase 2 design — playbook injection

[中文](DESIGN.zh.md) | English

Status: the offline pipeline produces repeated-failure candidates and the worker
playbook section exists. The first local 5+5 A/B (2026-11-09) showed no improvement and
more failed bash in the ON arm; the rule was not kept. Current prompt revision 2 has an
empty playbook. See `AB-RESULT-2026-11-09.md`; the 20-case corpus produced three
conventional rules (docs/test/refactor), not worth injecting on their own.

## Goal

Let a reviewed, cited playbook change worker behavior, and measure whether it does.
Non-goals: it cannot change Policy, a Mandate, the admission table or tool limits; it is
advisory text inside the existing prompt, not a new authority.

## Where the playbook lives

A **new team section** of the existing prompt configuration, edited in the panel and
versioned by the prompt revisions the deployment already keeps.

- `TEAM_SECTIONS` gains `playbook`; `promptParts` adds it for `worker` (and only later
  for `orchestrator`).
- Saving it goes through `PUT prompts` with `baseRevision`, as every team section does,
  so the panel offers history and rollback.
- The generated text is pasted by a person after reviewing `tools/memory/dist/rules.json`
  against its evidence; `distill.mjs` never writes the prompt.

Why not a hidden file under the state directory: the playbook is behavior-shaping content,
so it must be reviewed like code, and the prompt revision history is the review trail.
Why not a new file-injection mechanism: it would duplicate versioning, rollback and
panel editing that already exist.

## Failure candidates

`analyze-cases.mjs` turns every failed tool result into a normalized signature
(tool + error class + stable key identifiers; paths, timestamps and ids stripped).
Repeated signatures become **failure candidates** in `report.md`, with their case ids,
outcomes and a symptom. This is evidence, not a rule:

- the candidate has no possible cause, probe or disposition yet;
- a human supplies those, cites the cases, and writes one line into the `playbook`
  section only after checking at least three cases;
- a signature that only makes an ability verdict (e.g. “the tool is broken”) is
  quarantined and never becomes a candidate;
- a deliberate `exit 1` and a DNS failure must not share a signature.

The prompt section is worker-only and empty by default. The orchestrator does not read
it; the playbook cannot change Policy, a Mandate or tool limits.

## Content rules

- One rule per line, each with a scope (`docs`, `test`, `refactor`, `bugfix`, `ci`) and a
  check a worker can run; no prose essays.
- Every rule cites at least three case ids from `dist/clusters.json`; a rule that cannot
  cite them stays in `candidates`.
- No quoted request text, web content, PR bodies or issue text: untrusted data never
  becomes a rule.
- Bounded size: about 2 KB. Beyond that, the playbook crowds out the task-specific context.
- A rule that stops being confirmed (evidence contradicts it, or no case in the last N
  tickets) is removed in a new prompt revision, not silently kept.

## Rollout

1. Wait until the corpus has 30–40 cases and each candidate has `n >= 3`.
2. Run `pnpm memory:analyze`; review the failure candidates in `report.md`; run
   `pnpm memory:distill`; paste only high-confidence rules into the `playbook` team
   section; save a prompt revision.
3. **A/B**: 5 tickets with the playbook revision, 5 without. Alternate revisions per
   ticket; keep the issue types matched (same intent and roughly same size).
4. Compare per ticket, from the cases and the worker traces:

   | Metric | Source |
   | --- | --- |
   | steps, bash calls, failed bash | `analyze-cases.mjs` trace digest |
   | retries, human follow-ups, handbacks | case `cost` |
   | blocked / failed reports | case `reports` |
   | time to a ready PR | `createdAt` → last report `at` |

5. Keep the playbook only if it improves at least one metric without making another worse.
   Otherwise revert the prompt revision and record why in `candidates.md`.

## Rollback and safety

- Rollback is a prompt revision, the same as any team-section edit.
- The playbook cannot authorize a file, tool, branch or merge it did not already have.
- A worker that ignores a rule is not a failure of the gate; it is data for the next
  distillation. A worker that follows a wrong rule is why every rule cites evidence.

## Open questions

- One playbook per deployment (one repository) vs per repository: the current deployment
  is one repository, so the team section is enough; a multi-repository deployment would
  need a per-repository selection.
- Whether the orchestrator should see the same playbook or a shorter decision-oriented
  subset.
- How long evidence stays valid: a `last_confirmed` per rule in `rules.json` is the next
  small addition to the distill output.
