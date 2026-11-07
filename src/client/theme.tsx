/** Appearance control over the host theme service: light/dark preference, system follow, and resolved palette. */
import { useCallback, useEffect, useState } from 'react'
import type { ThemePreference, ThemeRuntime, ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'

/** Preferences in display order; `system` resolves through the operating system color scheme. */
export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const
/** Locale key of each preference's label. */
export const THEME_LABELS = { system: 'theme.system', light: 'theme.light', dark: 'theme.dark' } as const
export type { ThemePreference }

/** The panel's theme state, mirroring the host's durable preference and the palette it resolved. */
export interface ThemeControl {
  /** The persisted preference, which may still be `system`. */
  preference: ThemePreference
  /** The palette the host resolved; while the preference is `system` it follows the OS. */
  colorScheme: 'light' | 'dark'
  /** Persist and apply a preference through the host theme service. */
  setTheme: (preference: ThemePreference) => void
}

/** The Cordis context face this module needs; the full panel context satisfies it. */
export interface ThemeHost {
  get(name: 'theme'): ThemeRuntime | undefined
  on(name: 'theme/change', listener: (snapshot: ThemeSnapshot) => void): () => void
}

/**
 * Subscribe to the host theme service and expose the preference and palette the panel renders.
 * Returns `undefined` when the host composition has no theme plugin, so the Appearance control can explain instead of guessing.
 */
export function useThemeControl(host: ThemeHost): ThemeControl | undefined {
  const service = host.get('theme')
  const [snapshot, setSnapshot] = useState<ThemeSnapshot | undefined>(() => service?.getTheme())
  useEffect(() => {
    if (!service) return
    // A service that appeared after the first render needs its current snapshot; a later event overwrites it.
    setSnapshot(current => current ?? service.getTheme())
    return host.on('theme/change', next => setSnapshot(next))
  }, [host, service])
  const setTheme = useCallback((preference: ThemePreference) => { service?.setTheme(preference) }, [service])
  if (!service || !snapshot) return undefined
  return { preference: snapshot.preference, colorScheme: snapshot.active.colorScheme, setTheme }
}
