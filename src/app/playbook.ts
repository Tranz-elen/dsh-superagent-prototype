/** Validation for a human-reviewed failure playbook before it reaches a worker prompt. */
import { UserError } from '../core/index.ts'

export const PLAYBOOK_MAX_BYTES = 2 * 1024
const ABILITY_VERDICT = /不可用|不靠谱|别用|坏了|无法使用|不能用|不能使用|\b(?:tool|command|plugin|script)\s+(?:is\s+)?(?:unusable|unreliable|broken)\b|\b(?:do not|don't)\s+use\s+(?:the\s+)?(?:tool|command)\b/i
const ACTION = /\b(read|retry|rerun|run|check|ask|stop|switch|verify|use|open|write|edit|hand off|move|delete|restore)\b|读取|重试|重新|检查|询问|移交|停止|运行|执行|改用|确认|修改|删除|打开|写入/i

/** The problems with a playbook text; an empty string is allowed and has none. */
export function playbookProblems(text: string): string[] {
  const value = String(text ?? '').trim()
  if (!value) return []
  const problems: string[] = []
  if (Buffer.byteLength(value, 'utf8') > PLAYBOOK_MAX_BYTES) problems.push(`it exceeds ${PLAYBOOK_MAX_BYTES} bytes`)
  if (ABILITY_VERDICT.test(value)) problems.push('it makes an ability verdict instead of naming a symptom and an action')
  const lines = value.split('\n').map(line => line.trim()).filter(Boolean)
  if (lines.length > 20) problems.push('it has more than 20 rule lines')
  if (lines.length && !lines.some(line => ACTION.test(line))) problems.push('no rule contains an executable action')
  return problems
}

/** Reject a playbook that breaks the review contract; an empty playbook is valid. */
export function validatePlaybook(text: string): void {
  const problems = playbookProblems(text)
  if (problems.length) throw new UserError('invalidPlaybook', { reason: problems.join('; ') })
}
