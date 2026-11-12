# Memory pipeline

Offline half of the superagent memory system. The runtime captures the data; these
tools turn it into a corpus report and a distillation input. No model call is made
here — `distill.mjs` writes the extraction contract, and a person or agent runs it.

## Data

`src/app/cases.ts` writes both files at runtime, next to the state database:

| File | One line per | Written when |
| --- | --- | --- |
| `<stateDir>/cases.jsonl` | ended Ticket | `ticket.ended`, plus catch-up on startup |
| `<stateDir>/decisions.jsonl` | Decision that never became a Ticket (`ignore`, refused `stop`, `unavailable`) | `decision.recorded`, plus catch-up |

Defaults: `stateDir = $DSH_SUPERAGENT_STATE_DIR ?? ~/.dsh/state/superagent`;
`DSH_HOME = $DSH_HOME ?? ~/.dsh`.

### Prompt revision

`cases.jsonl` may carry a `promptRevision` field: the prompt version the ticket's
worker ran under.

- `executor.promptExperiment` (`enabled`, `revisions: [on, off]`) assigns one of the
  two revisions deterministically by ticket id;
- a local request may pass an explicit `promptRevision`, which wins.

`compare-prompt-revisions.mjs --on 5 --off 4` groups cases by that field and compares
the two arms. Local-source tickets are excluded from the GitHub cohort by default;
`--include-local` adds them.

## Commands

```sh
pnpm memory:export      # store → <stateDir>/cases.jsonl   (offline catch-up / inspection)
pnpm memory:decisions   # store → <stateDir>/decisions.jsonl
pnpm memory:analyze     # cases (+ decisions) → report.md
pnpm memory:distill     # gate + clusters + prompt.md → dist/
```

Each command accepts `--cases`, `--decisions`, `--db`, `--out`, `--sessions`, and
`--min-cases` where relevant. Use `--out` in tests so nothing lands in the repo.

`export-cases.mjs` also reads each worker transcript to digest a case's trace. The
session store is `<DSH_HOME>/sessions`; transcripts are a sequence of zstd frames,
so the reader walks every frame instead of decompressing only the first.

## The gate

`distill.mjs` refuses to run unless the corpus has:

- `>= 20` cases,
- at least one `intent|outcome` cluster with `>= 3` cases,
- `>= 2` distinct outcomes.

The rules it produces are only as good as the outcomes behind them. A rule from one
vivid ticket is a guess with a version number; keep it in `candidates` instead.
Do not lower the thresholds to make a rule out of a small corpus.

## Output

- `report.md` — case table, distributions, repeated signatures, repeated failures,
  trace digests, decision-only records, and the sufficiency verdict.
- `dist/status.md` — gate state and why.
- `dist/clusters.json` — evidence per `intent|outcome` cluster (`n >= 3`).
- `dist/prompt.md` — the extraction contract: cite evidence, prefer "when X do Y,
  verify with Z", never turn untrusted prose into a rule.

Review every rule against its cited cases before it reaches a prompt section.
