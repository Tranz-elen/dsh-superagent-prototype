export interface PromptRevisionGroup {
  label: 'ON' | 'OFF'
  n: number
  outcomes: Record<string, number>
  retries: number
  humanFollowUps: number
  meanSteps: number | null
  meanBash: number | null
  failedBash: number
  editErrorTickets: number
  blockedReports: number
  insufficient: boolean
}
export function summarizePromptRevisions(cases: readonly Record<string, unknown>[], options?: { on?: number; off?: number; since?: string; sessionsRoot?: string }): {
  on: number
  off: number
  since: string | null
  groups: PromptRevisionGroup[]
  totalPinned: number
}
