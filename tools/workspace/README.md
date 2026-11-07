# Workspace tools

Snapshot / diff / apply for a local content workspace that is not a git repository
(the mistake notebook is the first one). The worker edits a copy; a person applies it.

## Protocol

1. **Snapshot** before a task:
   ```sh
   node tools/workspace/snapshot.mjs --workspace /mnt/d/错题本 --id <ticket>
   ```
   Creates `.work/<ticket>/`, copies every file (excluding `.work`, `.git`, `node_modules`,
   audio folders, and files over 5 MB), and writes `snapshot.json` with the sha256 of each
   file. The HTML practice pages are in that manifest, so **the page hash for a score code
   is available** without a separate step.
2. **Work** only in `.work/<ticket>/`. The request tells the worker: no PR, no writes to the
   original, report changed files; any status change must cite the raw score code and the
   page hash from `snapshot.json`, otherwise write `待核对`.
3. **Diff**:
   ```sh
   node tools/workspace/diff.mjs --snapshot /mnt/d/错题本/.work/<ticket>
   ```
   Exit 1 on changes; prints `{changed, added, deleted}`.
4. **Apply** after review:
   ```sh
   node tools/workspace/apply.mjs --snapshot /mnt/d/错题本/.work/<ticket> --confirm
   ```
   Refuses to overwrite a file changed in the workspace after the snapshot; refuses
   deletions unless `--allow-delete`. Then run the workspace's own index/check scripts
   on the real tree.

## Why the snapshot lives in the workspace

Windows PowerShell cannot read WSL paths such as `/root/...`; it can read `D:\错题本\...`.
Putting `.work/<ticket>` under the workspace lets both sides see the same files.

## Limits

- `.work/` is transient and excluded from every snapshot; delete it after applying.
- Binary/audio files are skipped when over 5 MB; reference them from the original path.
- This is the script-level v1. Wiring it into the Executor's prepare/apply is the next step.
