/** Deterministic ON/OFF prompt-revision assignment for a ticket cohort. */
export interface PromptExperiment { enabled: boolean; revisions: number[] }

/** FNV-1a, stable across processes and platforms; the ticket id is the randomization unit. */
function hash(text: string): number {
  let value = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i)
    value = Math.imul(value, 0x01000193)
  }
  return value >>> 0
}

/** Pick one of two revisions for a ticket; disabled or malformed experiments return undefined. */
export function assignedPromptRevision(ticketId: string, experiment: PromptExperiment | undefined): number | undefined {
  if (!experiment?.enabled || experiment.revisions.length !== 2) return undefined
  if (experiment.revisions.some(revision => !Number.isInteger(revision) || revision < 0)) return undefined
  return experiment.revisions[hash(ticketId) % 2]
}
