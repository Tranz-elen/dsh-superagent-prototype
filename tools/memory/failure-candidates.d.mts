export interface FailureCandidate {
  signature: string
  count: number
  cases: string[]
  outcomes: string[]
  symptom: string
  needs: string
}
export function buildFailureCandidates(cases: readonly unknown[], options?: { minCount?: number }): {
  candidates: FailureCandidate[]
  quarantined: number
  failures: number
  minCount: number
}
export function validateFailureCandidate(candidate: unknown): string[]
export function validatePlaybookText(text: unknown, options?: { maxBytes?: number }): string[]
export function failureCandidatesDocument(result: unknown, options?: { cases?: number }): unknown
