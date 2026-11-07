/** Settings tab shell routing between stage settings (Sources, Eval, Execution), Prompts, Deployment, and the panel's appearance. */
import type { StateView } from './api.ts'
import { SegmentedControl } from './controls.tsx'
import { DeploymentPage, type DeploymentForm } from './deployment.tsx'
import { EvalSettings } from './eval.tsx'
import { ExecutionSettings } from './execution.tsx'
import { PromptsPage } from './prompts.tsx'
import { usePanel } from './provider.tsx'
import { SETTINGS_GROUPS, settingsRoute, type SettingsGroup } from './route.ts'
import { SettingsProvider } from './settings-kit.tsx'
import { SourceSettings } from './source.tsx'
import { THEME_LABELS, THEME_PREFERENCES, type ThemeControl } from './theme.tsx'

const STAGE_GROUPS: readonly SettingsGroup[] = ['source', 'eval', 'execution']

/** Theme preference over the host's light, dark, and system palettes; the choice persists in the host settings. */
function AppearanceSettings({ theme }: { theme: ThemeControl | undefined }) {
  const { t } = usePanel()
  if (!theme) return <p className="dt-hint">{t('appearanceUnavailable')}</p>
  const scheme = t(`theme.${theme.colorScheme}`)
  return <section className="dt-card">
    <div className="dt-section">
      <h3 className="dt-section-title">{t('appearanceTheme')}</h3>
      <SegmentedControl label={t('appearanceTheme')} value={theme.preference}
        options={THEME_PREFERENCES.map(value => ({ value, label: t(THEME_LABELS[value]) }))}
        onChange={value => theme.setTheme(value)} />
      <p className="dt-hint">{theme.preference === 'system' ? t('appearanceSystemHint', { theme: scheme })
        : t('appearanceThemeHint')}</p>
    </div>
  </section>
}

export function SettingsPage({ group, query, state, deploymentForm, theme }: {
  group: SettingsGroup; query: { source?: string; version?: string }; state: StateView; deploymentForm: DeploymentForm
  theme: ThemeControl | undefined
}) {
  const { t, navigate } = usePanel()
  const content = (() => {
    switch (group) {
      case 'source': return <SettingsProvider><SourceSettings {...query.source ? { focus: query.source } : {}} /></SettingsProvider>
      case 'eval': return <SettingsProvider><EvalSettings version={query.version} /></SettingsProvider>
      case 'execution': return <SettingsProvider><ExecutionSettings /></SettingsProvider>
      case 'prompts': return <PromptsPage />
      case 'deployment': return <DeploymentPage setup={state.setup} form={deploymentForm} />
      case 'appearance': return <AppearanceSettings theme={theme} />
    }
  })()
  return <div className="dt-settings">
    <nav className="dt-settings-nav" aria-label={t('tab.settings')}>
      {SETTINGS_GROUPS.map(value => <button key={value} type="button" className="dt-settings-link" data-stage={STAGE_GROUPS.includes(value)
        || undefined}
        aria-current={value === group ? 'page' : undefined} onClick={() => navigate(settingsRoute(value),
          true)}>{t(`settingsGroup.${value}`)}</button>)}
    </nav>
    <div className="dt-settings-body">
      <h2 className="dt-settings-title">{t(`settingsGroup.${group}`)}</h2>
      {content}
    </div>
  </div>
}
