# Real-ticket observation — failure playbook

Date: 2026-11-09

## Current state

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

## Experiment live

- `executor.promptExperiment` is enabled with revisions `[5, 4]`; assignment is deterministic by ticket id.
- Every new ticket's `promptRevision` is exported in `cases.jsonl`.
- Compare groups with:

```sh
node tools/memory/compare-prompt-revisions.mjs --on 5 --off 4 --since 2026-11-09T12:00:00Z
```

The report is descriptive; it marks groups under 5 cases as insufficient and does not claim causality.
