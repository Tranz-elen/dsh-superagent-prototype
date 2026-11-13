# Real-ticket observation — failure playbook

Date: 2026-11-09

## Historical state (2026-11-09)

- Worker prompt revision 5 (ON) contains the reviewed `edit: cannot modify` rule.
- Revisions 2 and 4 are OFF; revisions 0 and 2/4 are empty playbooks.
- The corrected local 5+5 A/B improved mean steps 15.0 -> 8.0 and mean bash 10.8 -> 3.8.
- No new real (non-A/B) ticket has arrived since the playbook was enabled.

## Historical baseline (27 real cases, before revision 5)

| Metric | Value |
|---|---:|
| cases | 27 |
| outcomes | merged 16, completed 6, stopped 5 |
| retries | 2 |
| human follow-ups | 0 |
| mean steps | 57.8 |
| mean bash calls | 47.3 |
| failed bash | 36 |

This baseline mixes several ticket types and is not an apples-to-apples cohort; it is a watchline, not an A/B control.

## What to watch on the next real tickets

- `edit:error:cannot+modify` incidence and recovery steps;
- failed bash, retries, human follow-ups;
- blocked/failed reports and time to a ready PR;
- any new failure caused by the playbook (wrong action, scope expansion).

## Decision rule

Keep revision 5 while the real tickets do not regress. If a real ticket shows a worse failed-bash, retry, handback or blocked-report pattern attributable to the rule, roll back to revision 4 (empty playbook) and record it here.

## Evidence

- Local corrected A/B: `AB-RESULT-2026-11-09.md`
- Live state: `/root/.dsh/state/superagent/orchestrator.sqlite`
- Real cases: `/root/.dsh/state/superagent/cases.jsonl`

## Experiment (historical)

- `executor.promptExperiment` **was** enabled with revisions `[5, 4]`; it is now disabled.
- Every new ticket's `promptRevision` is exported in `cases.jsonl`.
- Compare groups with:

```sh
node tools/memory/compare-prompt-revisions.mjs --on 5 --off 4 --since 2026-11-09T12:00:00Z
```

The report is descriptive; it marks groups under 5 cases as insufficient and does not claim causality.


## Final wrap-up (2026-11-12)

The GitHub batch cohort finished and the playbook was rolled back.

| Metric | ON (revision 5) | OFF (revision 4) |
|---|---:|---:|
| valid merged cases | 21 | 17 |
| mean steps | 35.1 | 34.1 |
| mean bash | 40.6 | 35.9 |
| failed bash | 49 | 27 |
| edit errors | 0 | 2 |

Decision:

- revision 5 did not outperform revision 4; ON had materially more failed bash;
- current prompt is revision 6, restored from revision 4 (empty playbook);
- `executor.promptExperiment` is disabled; no new ticket is assigned ON/OFF;
- revision 5 and `rules.json` remain as history for audit;
- the `edit-read-first` rule is not suitable as a playbook: the tool error already tells the worker to read the file and retry, and the measured cohort did not improve;
- the watcher and recurring reminder are stopped; no open tickets;
- snapshot `.gitignore` handling is separate Executor infrastructure work (PR #150), not a memory rule.

Future work should start from a failure that the tool does not already self-correct, or from a tool/process change rather than another prompt variant. Re-running the same docs cohort is not useful evidence.
