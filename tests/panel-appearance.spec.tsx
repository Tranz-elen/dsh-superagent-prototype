// @vitest-environment jsdom
// The panel Appearance group over the host theme service.
import { act } from 'react'
import type { ThemePreference, ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { expect, it, vi } from 'vitest'
import { zh } from '../src/client/locales.ts'
import type { ThemeHost } from '../src/client/theme.tsx'
import { all, at, click, mount, text, usePanel } from './fixtures/panel.tsx'

usePanel()

type ColorScheme = 'light' | 'dark'
function snapshotOf(preference: ThemePreference, colorScheme: ColorScheme): ThemeSnapshot {
  return { preference, fontSizes: { text: 14, code: 11, terminal: 13 }, fontFamilies: { text: '', code: '', terminal: '' },
    active: { id: preference === 'system' ? colorScheme : preference, colorScheme, tokens: {} }, themes: [], revision: 0 }
}
/** A fake host theme service whose preference writes emit `theme/change`, as the real one does. */
function themeHost(preference: ThemePreference = 'system', scheme: ColorScheme = 'light') {
  let snapshot = snapshotOf(preference, scheme)
  const listeners = new Set<(snapshot: ThemeSnapshot) => void>()
  const publish = (next: ThemeSnapshot) => { snapshot = next; for (const listener of listeners) listener(snapshot) }
  const setTheme = vi.fn((next: ThemePreference) => publish(snapshotOf(next, next === 'system' ? scheme : next)))
  const service = { getTheme: () => snapshot, setTheme }
  const host: ThemeHost = {
    get: name => name === 'theme' ? service as never : undefined,
    on: (_name, listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  return { host, service, setTheme, publish: (next: ThemeSnapshot) => publish(next),
    setScheme: (next: ColorScheme) => publish(snapshotOf(snapshot.preference, next)) }
}
const selected = () => document.querySelector('.dt-segmented [role="tab"][aria-selected="true"]')?.textContent
const openAppearance = () => at({ page: 'settings', query: { group: 'appearance' } })

it('offers follow-system, light and dark, applies the host theme, and reflects changes made in the host settings', async () => {
  const theme = themeHost('system', 'light')
  openAppearance()
  await mount(zh, theme.host)
  expect(all('.dt-settings-link').map(link => link.textContent)).toContain(zh['settingsGroup.appearance'])
  expect(selected()).toBe(zh['theme.system'])
  expect(text()).toContain('跟随系统，当前为浅色')
  await click(zh['theme.dark'])
  expect(theme.setTheme).toHaveBeenCalledExactlyOnceWith('dark')
  expect(selected()).toBe(zh['theme.dark'])
  expect(text()).not.toContain('跟随系统，当前为')
  // A choice made in DeepSeek Harness Settings → General arrives as a host change.
  await act(async () => { theme.service.setTheme('light') })
  expect(selected()).toBe(zh['theme.light'])
})

it('keeps following the operating system while the preference is system, without writing a preference', async () => {
  const theme = themeHost('system', 'light')
  openAppearance()
  await mount(zh, theme.host)
  act(() => theme.setScheme('dark'))
  expect(selected()).toBe(zh['theme.system'])
  expect(text()).toContain('跟随系统，当前为深色')
  expect(theme.setTheme).not.toHaveBeenCalled()
})

it('explains that the host provides no theme service instead of guessing a preference', async () => {
  openAppearance()
  await mount()
  expect(selected()).toBeUndefined()
  expect(text()).toContain(zh.appearanceUnavailable)
})
