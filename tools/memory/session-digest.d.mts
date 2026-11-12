export function sessionPath(c: Record<string, unknown>, sessionsRoot: string): string | undefined
export function readSession(path?: string): unknown[]
export function digest(events: readonly unknown[]): { steps: number; tools: Record<string, number>; bash: { command: string; exit: number }[]; failures: { tool: string; detail: string; signature: string; quarantined: boolean }[]; edits: string[]; reads: string[] }
export function digestCase(c: Record<string, unknown>, sessionsRoot: string): ReturnType<typeof digest>
