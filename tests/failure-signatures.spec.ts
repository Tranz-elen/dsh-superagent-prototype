import { describe, expect, it } from 'vitest'
import { hasAbilityVerdict, normalizeFailureSignature } from '../tools/memory/failure-signatures.mjs'

describe('offline failure signatures', () => {
  it('separates a DNS failure from a deliberate exit 1', () => {
    const dns = normalizeFailureSignature('bash', '[stderr]\nlandlock-run: partial enforcement\ncurl: (6) Could not resolve host: example.invalid\n[exit code: 6]')
    const deliberate = normalizeFailureSignature('bash', '[stderr]\nlandlock-run: partial enforcement\n[exit code: 1]')
    expect(dns).not.toBe(deliberate)
    expect(dns).toContain('example.invalid')
    expect(deliberate).toContain('exit-1')
  })

  it('strips paths, line numbers, timestamps and ids', () => {
    const a = normalizeFailureSignature('read', 'Error: ENOENT C:\\work\\a.txt:12:3 at 2026-11-09T08:00:00Z 550e8400-e29b-41d4-a716-446655440000')
    const b = normalizeFailureSignature('read', 'Error: ENOENT /home/me/b.txt:99:7 at 2026-11-10T09:00:00Z 123e4567-e89b-12d3-a456-426614174000')
    expect(a).toBe(b)
  })

  it('rejects ability verdicts instead of storing them as symptoms', () => {
    expect(hasAbilityVerdict('web 工具不可用')).toBe(true)
    expect(hasAbilityVerdict('web_fetch 返回 DNS 解析失败')).toBe(false)
  })
})
