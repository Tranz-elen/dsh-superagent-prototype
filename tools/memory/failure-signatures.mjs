/**
 * Failure-signature normalization for the offline memory pipeline.
 *
 * A signature is tool + error class + stable key identifiers. It deliberately
 * strips paths, line numbers, timestamps and trace ids, but keeps exit/curl
 * codes and unresolved hosts so a DNS failure cannot inherit a deliberate
 * `exit 1` lesson. No ability verdict is ever stored: "the tool is broken" is a
 * pseudo-lesson; the pipeline records a symptom to investigate instead.
 */

const ABILITY_VERDICT = /不可用|不靠谱|别用|坏了|无法使用|不能用|不能使用|\b(?:tool|command|plugin|script)\s+(?:is\s+)?(?:unusable|unreliable|broken)\b|\b(?:do not|don't)\s+use\s+(?:the\s+)?(?:tool|command)\b/i

/** True when text makes a verdict about a tool's ability rather than naming a symptom. */
export function hasAbilityVerdict(text) {
  return ABILITY_VERDICT.test(String(text ?? ''))
}

/** Normalize (tool, error text) into a stable, reviewable signature. */
export function normalizeFailureSignature(tool, error) {
  const toolName = String(tool ?? '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '') || 'unknown'
  const text = String(error ?? '')
    .replace(/[A-Za-z]:\\[^\s'"]+/g, '<path>')
    .replace(/(?:^|\s)\/(?:[^\s/]+\/)+[^\s'"]*/g, ' <path>')
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<time>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '<id>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<id>')
    .replace(/:\d+:\d+\b/g, '')
    .replace(/^\s*at\s+.*$/gm, '')

  const host = /\bhttps?:\/\/([^/\s:]+)/i.exec(text)?.[1]?.toLowerCase().replace(/^www\./, '')
  const type = /\b(TypeError|RangeError|SyntaxError|Error|ENOENT|EACCES|EPERM|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|HTTP\s*\d{3})\b/i.exec(text)?.[1]
  const errorClass = (type || 'error').toLowerCase().replace(/\s+/g, '-')

  const keys = []
  if (host) keys.push(host)
  if (/fetch failed|\bfetch\b.*\bfailed\b/i.test(text)) keys.push('fetch')
  const unresolvedHost = /could not resolve host:\s*([^\s]+)/i.exec(text)?.[1]
  const curlCode = /curl:\s*\((\d+)\)/i.exec(text)?.[1]
  const exitCode = /\[exit code:\s*(\d+)\]/i.exec(text)?.[1]
  if (unresolvedHost) keys.push(unresolvedHost.toLowerCase())
  if (curlCode) keys.push(`curl-${curlCode}`)
  if (exitCode) keys.push(`exit-${exitCode}`)
  const node = /\b(node(?:\.js)?)(?:\s*v?\d+(?:\.\d+)*)?\b/i.exec(text)?.[1]
  if (node) keys.push('node')
  const quoted = [...text.matchAll(/[`'"]([A-Za-z][A-Za-z0-9_.-]{1,32})[`'"]/g)].map(match => match[1] ?? '')
  for (const token of quoted) {
    const normalized = token.toLowerCase().replace(/\.js$/i, '')
    if (normalized && normalized !== 'error') keys.push(normalized)
  }
  for (const token of [...text.matchAll(/\b([A-Za-z][A-Za-z0-9_-]{2,30})(?:\.js)?\b/g)].map(match => match[1] ?? '')) {
    const normalized = token.toLowerCase().replace(/\.js$/i, '')
    if (['error', 'failed', 'failure', 'typeerror', 'rangeerror', 'syntaxerror', 'node'].includes(normalized)) continue
    if (host && normalized === host.split('.')[0]) continue
    keys.push(normalized)
  }
  return `${toolName}:${errorClass}:${[...new Set(keys)].slice(0, 2).join('+') || 'generic'}`
}
