import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Button, Checkbox, Modal, SegmentedControl, Tag,
  IconChevronDownOutlineRegular, IconChevronRightOutlineRegular,
  IconCloseOutlineRegular, IconPlusOutlineRegular,
  type TagTone,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  McpManagerFailure, McpServerId, McpServerView,
  McpToolInjectionMode, McpToolsState, McpToolView,
} from './types.ts'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { McpServerForm, type McpServerFormRemote } from './ServerForm.tsx'
import { ServersJsonEditor, type ServersJsonEntry } from './ServersJsonEditor.tsx'
import { GlobalEnvEditor, type GlobalEnvRemote } from './GlobalEnvEditor.tsx'
import type { McpToolControlRemote } from './ToolControlSection.tsx'
import type { McpSettingsLocaleKey } from './locales.ts'
import { createMcpManagerStore, type McpDraft, type McpTestOutcome } from './mcp-store.ts'
import { MCP_PRESETS, presetToDraft, type McpPreset } from './presets.ts'
import css from './McpSettingsSection.module.css'

/** One adopt/release attempt: a business failure, or an advisory note. */
export interface McpTakeoverOutcome {
  readonly failure: McpManagerFailure | null
  readonly warning?: string
}

/** Registration-side Remote face used by the section. */
export interface McpManagerInjected extends McpServerFormRemote, McpToolControlRemote, GlobalEnvRemote {
  /** Read the current server list. */
  list: () => Promise<readonly McpServerView[]>
  /** Persist one draft; null means success, a failure is otherwise returned. */
  save: (draft: McpDraft) => Promise<McpManagerFailure | null>
  /** Delete one server; null means success, a failure is otherwise returned. */
  remove: (id: McpServerId) => Promise<McpManagerFailure | null>
  /** Probe one draft; `draft.id` lets stored secret values resolve. */
  test: (draft: McpDraft) => Promise<McpTestOutcome>
  /** Replace the whole server list (JSON editor path). */
  upsertJson: (servers: readonly ServersJsonEntry[]) => Promise<{ added: number; updated: number; removed: number; skipped?: number }>
  /** Take a declared server over so the plugin owns the mount (enables OAuth). */
  adopt: (serverName: string) => Promise<McpTakeoverOutcome>
  /** Give an adopted server back to its declaration. */
  release: (serverName: string) => Promise<McpTakeoverOutcome>
}

/** Full component props assembled by the Settings slot renderer. */
export type McpSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.mcp'>
  & PropsStore<ReturnType<typeof createMcpManagerStore>>
  & InjectFace<McpManagerInjected>

/** Phase label key for a status badge. */
function phaseKey(phase: McpServerView['status']['phase']): McpSettingsLocaleKey {
  switch (phase) {
    case 'mounting': return 'statusMounting'
    case 'live': return 'statusLive'
    case 'failed': return 'statusFailed'
    case 'stopped': return 'statusStopped'
  }
}

/** Tag palette for a mount phase: a live mount reads green, a failure red. */
function phaseTone(phase: McpServerView['status']['phase']): TagTone {
  switch (phase) {
    case 'mounting': return 'info'
    case 'live': return 'success'
    case 'failed': return 'danger'
    case 'stopped': return 'neutral'
  }
}

/** Raw `mcp__<server>__<tool>` tail, for the tool list. */
function rawOf(name: string): string {
  const rest = name.slice(5)
  const i = rest.indexOf('__')
  return i < 0 ? rest : rest.slice(i + 2)
}

/** localStorage key holding the ids of presets the user removed from the list. */
const PRESET_HIDDEN_KEY = 'dsh-destinywind-mcp.hiddenPresets'

/**
 * Preset ids the user removed. Read defensively: a missing, corrupt or blocked
 * store means nothing is hidden, never a crash on first paint.
 */
function readHiddenPresets(): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(PRESET_HIDDEN_KEY)
    if (raw === null) return new Set()
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? new Set(parsed.filter((id): id is string => typeof id === 'string'))
      : new Set()
  } catch (error) {
    console.error('[dsh-mcp] hidden presets unreadable:', error)
    return new Set()
  }
}

/**
 * One preset: a template, not a server. It prefills the create form, and one
 * that needs a token the manager does not hold yet is marked and ships
 * disabled. The same row serves both places a preset is offered — the create
 * dialog and the server list — and only the list passes `onRemove`, because
 * only there can a preset be dismissed.
 */
function PresetRow(props: {
  readonly t: (key: McpSettingsLocaleKey) => string
  readonly preset: McpPreset
  readonly onPick: (preset: McpPreset) => void
  readonly onRemove?: (preset: McpPreset) => void
}): ReactNode {
  const { t, preset, onPick, onRemove } = props
  return (
    <div className={css.mcpPresetRow}>
      <div className={css.mcpPresetInfo}>
        <span className={css.mcpPresetName}>{t(preset.nameKey)}</span>
        <Tag tone="neutral">{t('presetBadge')}</Tag>
        {preset.needsSecret ? (
          // Tag takes no title, so the explanation rides the wrapper.
          <span title={t('presetNeedsSecretHint')}>
            <Tag tone="warning">{t('presetNeedsSecret')}</Tag>
          </span>
        ) : null}
        <p className={css.mcpPresetDesc}>{t(preset.descKey)}</p>
      </div>
      <div className={css.mcpPresetActions}>
        <a className={css.mcpPresetDocs} href={preset.docs} target="_blank" rel="noreferrer">docs</a>
        <Button size="sm" variant="outline" onClick={() => onPick(preset)}>{t('presetUse')}</Button>
        {onRemove === undefined ? null : (
          <Button size="sm" variant="ghost" onClick={() => onRemove(preset)}>{t('remove')}</Button>
        )}
      </div>
    </div>
  )
}

/**
 * Preset gallery for the create dialog: each entry prefills the form with a
 * known-good server definition. Renders nothing once every preset has been
 * removed from the list, so an emptied gallery cannot leave a bare heading.
 */
function PresetPicker(props: {
  readonly t: (key: McpSettingsLocaleKey) => string
  readonly presets: readonly McpPreset[]
  readonly onPick: (preset: McpPreset) => void
}): ReactNode {
  const { t, presets, onPick } = props
  if (presets.length === 0) return null
  return (
    <div className={css.mcpPresets}>
      <p className={css.mcpPresetTitle}>{t('presetsTitle')}</p>
      {presets.map(preset => <PresetRow key={preset.id} t={t} preset={preset} onPick={onPick} />)}
      <p className={css.mcpHint}>{t('presetsHint')}</p>
    </div>
  )
}

/** Rebuild an editable draft from a stored server view (quick toggle path). */
function viewToDraft(server: McpServerView): McpDraft {
  return {
    id: server.id,
    serverName: server.serverName,
    transport: server.transport,
    enabled: server.enabled,
    command: server.command,
    argsText: server.args.join('\n'),
    cwd: server.cwd,
    url: server.url,
    headersText: server.headers.map(header => `${header.name}: ${header.value}`).join('\n'),
    toolCallTimeoutMs: String(server.toolCallTimeoutMs),
    oauth: server.oauth === true,
    failOnStartupError: server.failOnStartupError,
  }
}

/**
 * Render the MCP management page: the injection-mode selector (default
 * on-demand search), the server list with per-server refresh and an expandable
 * per-server tool-binding list, or the editor when a draft is open.
 *
 * Layout follows the Settings shell's own card idiom — a section heading, then
 * one card per concern (process env vars, MCP config). Controls come from the
 * UI primitives rather than a private button sheet: this plugin's stylesheets
 * are injected verbatim (identity class map, no hashing), so every hand-written
 * rule is app-global and a bespoke `button {}` rule once restyled the composer.
 */
export function McpSettingsSection(props: McpSettingsSectionProps): ReactNode {
  const { list, save, remove, test, adopt, release } = props
  const state = props.useStore(snapshot => snapshot)
  const { setLoadState, setServers, beginCreate, beginEdit, cancelEdit, updateDraft, setBusy, setTestRunning, setTest } = props.actions
  const t = props.t

  const [loadErrorDetail, setLoadErrorDetail] = useState<string | null>(null)
  const [hostMissing, setHostMissing] = useState(false)
  const [tools, setTools] = useState<McpToolsState | null>(null)
  const [toolsError, setToolsError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [refreshing, setRefreshing] = useState<ReadonlySet<string>>(new Set())
  const [jsonOpen, setJsonOpen] = useState(false)
  const [envOpen, setEnvOpen] = useState(true)
  const [presetNotice, setPresetNotice] = useState<string | null>(null)
  // Presets are offered in the list and can be dismissed there. The set is
  // read once at mount: it is this browser's own preference, not Host state.
  const [hiddenPresets, setHiddenPresets] = useState<ReadonlySet<string>>(readHiddenPresets)
  const [adopting, setAdopting] = useState<ReadonlySet<string>>(new Set())
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<string | null>(null)
  const timersRef = useRef<number[]>([])
  let inlineForm: ReactNode | null = null
  let createForm: ReactNode | null = null

  useEffect(() => () => {
    for (const id of timersRef.current) window.clearTimeout(id)
  }, [])

  const refreshTools = (): void => {
    void props.toolsList().then(
      (next) => { setTools(next); setToolsError(null) },
      (error) => {
        console.error('[dsh-mcp] toolsList failed:', error)
        setToolsError(String((error instanceof Error ? error.message : error) ?? error))
        setTools(null)
      },
    )
  }

  const fail = (error: unknown): void => {
    // The settings shell hides Remote failures behind a generic copy; surface
    // the real message here so a broken list() is diagnosable from the page.
    console.error('[dsh-mcp] list failed:', error)
    const message = String((error instanceof Error ? error.message : error) ?? error)
    setLoadErrorDetail(message)
    // HTTP 404 on /api/mcpManager/* means the host did not register the
    // mcpManager Typert service (host half missing or client/host version
    // mismatch). Surface that distinctively instead of a bare transport error.
    setHostMissing(/HTTP 404|transport failure/.test(message))
    setLoadState('error')
  }

  const load = (): void => {
    void list().then(
      (servers) => {
        setServers(servers)
        setLoadState('ready')
        setLoadErrorDetail(null)
        setHostMissing(false)
      },
      (error) => fail(error),
    )
    refreshTools()
  }

  useEffect(() => {
    let current = true
    void list().then(
      (servers) => {
        if (!current) return
        setServers(servers)
        setLoadState('ready')
        setLoadErrorDetail(null)
        setHostMissing(false)
      },
      (error) => { if (current) fail(error) },
    )
    void props.toolsList().then(
      (next) => { if (current) { setTools(next); setToolsError(null) } },
      (error) => {
        if (!current) return
        console.error('[dsh-mcp] toolsList failed:', error)
        setToolsError(String((error instanceof Error ? error.message : error) ?? error))
        setTools(null)
      },
    )
    return () => { current = false }
  }, [list, setLoadState, setServers])

  const setMode = (mode: McpToolInjectionMode): void => {
    void props.toolsMode({ mode }).then(refreshTools, (error) => {
      console.error('[dsh-mcp] toolsMode failed:', error)
      refreshTools()
    })
  }

  const toggleTool = (tool: McpToolView): void => {
    const next = !tool.enabled
    // Optimistic local toggle; the Host is the source of truth.
    setTools(prev => prev === null
      ? prev
      : { ...prev, tools: prev.tools.map(item => item.name === tool.name ? { ...item, enabled: next } : item) })
    void props.toolsSet({ name: tool.name, enabled: next }).catch((error) => {
      console.error('[dsh-mcp] toolsSet failed:', error)
      refreshTools()
    })
  }

  const refreshServer = (serverName: string): void => {
    setRefreshing(prev => new Set(prev).add(serverName))
    void Promise.all([
      list().then(
        (servers) => { setServers(servers); setLoadState('ready'); setHostMissing(false) },
        () => {},
      ),
      props.toolsList().then(setTools, () => {}),
    ]).finally(() => {
      setRefreshing(prev => {
        const next = new Set(prev)
        next.delete(serverName)
        return next
      })
    })
  }

  const toggleExpand = (serverName: string): void => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(serverName)) next.delete(serverName)
      else next.add(serverName)
      return next
    })
  }

  const runAdopt = async (server: McpServerView): Promise<void> => {
    const giveBack = server.adopted === true
    // Giving a declaration back to a composition that cannot authenticate it
    // drops every tool it serves, so that variant states the consequence.
    const confirmKey = giveBack
      ? server.needsPlugin === true ? 'releaseConfirmNeedsPlugin' : 'releaseConfirm'
      : 'adoptConfirm'
    if (!window.confirm(t(confirmKey))) return
    setActionError(null)
    setActionNotice(null)
    setAdopting(prev => new Set(prev).add(server.serverName))
    try {
      const outcome = await (giveBack ? release(server.serverName) : adopt(server.serverName))
      if (outcome.failure !== null) setActionError(`${outcome.failure.code}: ${outcome.failure.message}`)
      else if (outcome.warning !== undefined) setActionNotice(outcome.warning)
    } catch (error) {
      setActionError(String((error instanceof Error ? error.message : error) ?? error))
    } finally {
      setAdopting(prev => {
        const next = new Set(prev)
        next.delete(server.serverName)
        return next
      })
      load()
    }
  }

  const toggleEnabled = async (server: McpServerView): Promise<void> => {
    const target = !server.enabled
    const draft = viewToDraft(server)
    draft.enabled = target
    try {
      const failure = await save(draft)
      if (failure !== null) {
        console.error('[dsh-mcp] setEnabled failed:', failure.message)
        return
      }
      await refreshServer(server.serverName)
      if (target) {
        // Mounting is asynchronous: refresh again after the connection settles
        // so the badge and tool count reflect the live state without a manual
        // refresh.
        timersRef.current.push(window.setTimeout(() => refreshServer(server.serverName), 2000))
      }
    } catch (error) {
      console.error('[dsh-mcp] setEnabled failed:', error)
    }
  }

  const serverTools = (serverName: string): McpToolView[] =>
    (tools?.tools ?? []).filter(tool => tool.server === serverName)

  /** Presets still offered: the catalog minus this browser's dismissals. */
  const visiblePresets = MCP_PRESETS.filter(preset => !hiddenPresets.has(preset.id))

  /**
   * Dismiss a preset from the list. A preset is a template the plugin ships,
   * not a server the Host stores, so this hides the row in this browser only —
   * it never touches servers or credentials. The entry is a convenience for
   * filling the form, and dismissing it cannot un-configure anything: a server
   * already created from it is an ordinary server and stays.
   */
  const removePreset = (preset: McpPreset): void => {
    const next = new Set(hiddenPresets).add(preset.id)
    setHiddenPresets(next)
    try {
      window.localStorage.setItem(PRESET_HIDDEN_KEY, JSON.stringify([...next]))
    } catch (error) {
      // Storage can be full or blocked; the row still hides for this session.
      console.error('[dsh-mcp] hidden presets not persisted:', error)
    }
  }

  /** Bring every dismissed preset back, so a removal is always reversible. */
  const restorePresets = (): void => {
    setHiddenPresets(new Set())
    try {
      window.localStorage.removeItem(PRESET_HIDDEN_KEY)
    } catch (error) {
      console.error('[dsh-mcp] hidden presets not cleared:', error)
    }
  }

  /**
   * Prefill the create form from a preset. A name the manager already holds
   * would be rejected on save, so that case is surfaced up front while the
   * form still opens for renaming. Shown inside the create dialog, not on the
   * page, so it cannot be mistaken for a page-level result.
   */
  const usePreset = (preset: McpPreset): void => {
    const draft = presetToDraft(preset)
    beginCreate()
    updateDraft(draft)
    setPresetNotice(
      state.servers.some(server => server.serverName === draft.serverName)
        ? `${t('presetNameTaken')} "${draft.serverName}"`
        : null,
    )
  }

  /** Open the create dialog: a blank draft is the dialog's own open flag. */
  const openCreate = (): void => {
    beginCreate()
    setPresetNotice(null)
  }

  /** Close the create dialog (its draft is the dialog's state, so drop both). */
  const closeCreate = (): void => {
    // A save in flight must not be discarded by a stray click on the backdrop.
    if (state.busy !== null || state.testRunning) return
    cancelEdit()
    setPresetNotice(null)
  }
  const mode = tools?.mode ?? 'search'

  // A new draft with no id is the create dialog. The Modal primitive owns its
  // own initial focus and Escape handling (useModalLayer), so no local focus
  // effect is needed — and keying one on the draft would yank focus out of the
  // field being typed into.
  const creating = state.draft !== null && state.draft.id === null

  if (state.loadState === 'loading') {
    return <p className={css.mcpStatus} aria-busy="true">{t('loading')}</p>
  }
  if (state.loadState === 'error') {
    return (
      <div className={css.mcpFailure}>
        <p role="alert">{t('loadError')}</p>
        {hostMissing ? <p className={css.mcpMuted}>{t('loadErrorHostMissing')}</p> : null}
        {loadErrorDetail !== null ? <pre className={css.mcpMuted}>{loadErrorDetail}</pre> : null}
        <Button variant="outline" size="sm" onClick={() => { setLoadState('loading'); load() }}>{t('retry')}</Button>
      </div>
    )
  }
  if (state.draft !== null) {
    const draft = state.draft
    const actions = {
      updateDraft,
      cancelEdit,
      setBusy,
      setTestRunning,
      setTest,
      setServers,
    }
    const form = (
      <McpServerForm
        draft={draft}
        busy={state.busy}
        testRunning={state.testRunning}
        test={state.test}
        t={t}
        actions={actions}
        injected={{ save, remove, test, list }}
        // The create dialog owns its own close button, so the form's
        // "back to list" button would be a second, redundant dismiss control.
        dismissible={draft.id !== null}
        onSaved={() => {
          // Mounting is asynchronous: refresh again after the connection
          // settles so the badge and tool count reflect the live state without
          // a manual refresh (mirrors the enable-toggle path).
          const serverName = draft.serverName
          timersRef.current.push(window.setTimeout(() => refreshServer(serverName), 2000))
          timersRef.current.push(window.setTimeout(() => refreshServer(serverName), 6000))
        }}
      />
    )
    // Creating opens a dialog (nothing on the page is being edited yet, so an
    // inline form would appear out of context at the top of the list); editing
    // stays inline right below the row it belongs to.
    if (draft.id === null) createForm = form
    else inlineForm = form
  }

  /** The mode hint doubles as the tabpanel the segmented control points at. */
  const modeHint = toolsError !== null
    ? toolsError
    : tools === null ? t('toolsLoading') : mode === 'search' ? t('toolsHintSearch') : t('toolsHintFull')

  return (
    <section className={css.mcpSection}>
      <h2 className={css.mcpHeading}>{t('nav')}</h2>

      <div className={css.mcpModeRow}>
        <SegmentedControl
          id="mcp-tool-mode"
          value={mode}
          options={[
            { value: 'search', label: t('toolsModeSearchShort') },
            { value: 'full', label: t('toolsModeFullShort') },
          ]}
          onChange={setMode}
          label={t('toolsModeLabel')}
        />
        <p
          className={css.mcpModeHint}
          id={`mcp-tool-mode-${mode}-panel`}
          role="tabpanel"
          aria-labelledby={`mcp-tool-mode-${mode}`}
        >
          {modeHint}
        </p>
      </div>

      <div className={css.mcpCard}>
        <div className={css.mcpCardHead}>
          <Button
            variant="ghost"
            className={css.mcpModuleToggle}
            aria-expanded={envOpen}
            icon={envOpen ? <IconChevronDownOutlineRegular /> : <IconChevronRightOutlineRegular />}
            onClick={() => setEnvOpen(open => !open)}
          >
            {t('globalEnv')}
          </Button>
        </div>
        {envOpen ? (
          <GlobalEnvEditor
            injected={{ envList: props.envList, envSet: props.envSet }}
            t={t}
            onApplied={() => {
              // New process env may feed header substitution: refresh server
              // rows (connection attempts re-resolve env) but keep the tool list.
              refreshServer('')
            }}
          />
        ) : null}
      </div>

      <div className={css.mcpCard}>
        <div className={css.mcpCardHead}>
          <span className={css.mcpModuleTitle}>{t('configTitle')}</span>
          <div className={css.mcpModuleActions}>
            <Button
              size="sm"
              variant={jsonOpen ? 'toolbar' : 'outline'}
              aria-expanded={jsonOpen}
              onClick={() => setJsonOpen(open => !open)}
            >
              {t('serversJson')}
            </Button>
            <Button size="sm" variant="primary" icon={<IconPlusOutlineRegular />} onClick={openCreate}>
              {t('addServer')}
            </Button>
          </div>
        </div>

        {actionError !== null ? (
          <p className={css.mcpWarn} role="alert">{t('actionFailed')}: {actionError}</p>
        ) : null}
        {actionNotice !== null ? (
          <p className={css.mcpNote} role="status">{t('actionNotice')}: {actionNotice}</p>
        ) : null}

        {jsonOpen ? (
          <ServersJsonEditor
            injected={{ list: props.list, upsertJson: props.upsertJson }}
            t={t}
            onApplied={() => {
              // The whole list changed on the Host: refresh the server rows and
              // the tool list, then close the JSON panel to show the UI list.
              refreshServer('')
              refreshTools()
              setJsonOpen(false)
              // Mounting is asynchronous: refresh again after the connection
              // settles so badges/tool counts reflect the live state.
              timersRef.current.push(window.setTimeout(() => refreshServer(''), 2000))
              timersRef.current.push(window.setTimeout(() => refreshServer(''), 6000))
            }}
          />
        ) : null}

        {/* No outer empty-state test: the list always renders when the JSON
            editor is closed, because a preset row or its restore row must stay
            reachable even with no server configured. The "no servers yet" note
            lives inside the list instead. */}
        {jsonOpen ? null : (
        <ul className={css.mcpList}>
          {/* Presets lead the list: they are the starting point for a server
              that does not exist yet, so they read before the configured ones.
              Each is a template, not a stored server — the row carries a
              "预设" badge and a remove action that dismisses it locally. */}
          {visiblePresets.map(preset => (
            <li key={`preset-${preset.id}`}>
              <PresetRow t={t} preset={preset} onPick={usePreset} onRemove={removePreset} />
            </li>
          ))}
          {hiddenPresets.size > 0 ? (
            <li className={css.mcpPresetRestore}>
              <span className={css.mcpMuted}>{t('presetsRemoved')}</span>
              <Button size="sm" variant="ghost" onClick={restorePresets}>{t('presetsRestore')}</Button>
            </li>
          ) : null}
          {/* Stated whenever no server is configured yet, so the presets above
              read as suggestions rather than as configured servers. */}
          {state.servers.length === 0 ? (
            <li><p className={css.mcpMuted}>{t('empty')}</p></li>
          ) : null}
          {state.servers.flatMap(server => {
            const isExpanded = expanded.has(server.serverName)
            const isRefreshing = refreshing.has(server.serverName)
            const serverToolList = serverTools(server.serverName)
            // Declared servers are mounted by the composition, so this page
            // only views them: no enable/disable, no refresh, no editor.
            const declared = server.source === 'cordis'
            const card = (
              <li key={server.id} className={css.mcpServerCard}>
                <div className={css.mcpServerHead}>
                  <div className={css.mcpServerMain}>
                    <div className={css.mcpServerTitle}>
                      <span className={css.mcpServerName}>{server.serverName}</span>
                      {/* A name the composition currently serves is declared, not
                          disabled: showing the mount phase as "未启用" would be wrong
                          and the enable/disable button cannot take effect. */}
                      {declared ? <Tag tone="neutral">{t('sourceCordis')}</Tag> : null}
                      {server.pendingTakeover ? (
                        <Tag tone="warning">{t('pendingBadge')}</Tag>
                      ) : server.conflict ? (
                        <Tag tone="warning">{t('conflictBadge')}</Tag>
                      ) : (
                        <Tag tone={phaseTone(server.status.phase)}>{t(phaseKey(server.status.phase))}</Tag>
                      )}
                      {!server.enabled && server.status.phase !== 'stopped' ? <span className={css.mcpMuted}>{t('statusStopped')}</span> : null}
                    </div>
                    <div className={css.mcpServerMeta}>
                      <span>{server.transport}</span>
                      <span>{t('toolCount')}: {server.status.tools.length}</span>
                      <span>{t('envVars')}: {server.env.length}</span>
                    </div>
                    {server.declaredIn ? (
                      <p className={css.mcpPath} title={server.declaredIn}>{t('declaredIn')}: {server.declaredIn}</p>
                    ) : null}
                    {server.conflict ? <p className={css.mcpWarn}>{t('conflictDeclared')}</p> : null}
                    {server.needsPlugin ? <p className={css.mcpWarn}>{t('needsPluginHint')}</p> : null}
                    {server.status.error ? <p className={css.mcpWarn}>{server.status.error}</p> : null}
                    {declared ? <p className={css.mcpNote}>{t('readOnlyHint')}</p> : null}
                    {server.stale ? <p className={css.mcpNote}>{t('staleMirror')}</p> : null}
                    {server.skipReason === 'js-expression' ? <p className={css.mcpWarn}>{t('skipJsExpr')}</p> : null}
                    {server.pendingTakeover ? <p className={css.mcpNote}>{t('pendingTakeover')}</p> : null}
                    {declared && server.oauthHint ? <p className={css.mcpWarn}>{t('oauthHint')}</p> : null}
                  </div>
                  <div className={css.mcpServerActions}>
                    {declared || server.conflict || server.pendingTakeover ? null : (
                      <Button size="sm" variant="ghost" disabled={isRefreshing} onClick={() => void toggleEnabled(server)}>
                        {server.enabled ? t('disable') : t('enabled')}
                      </Button>
                    )}
                    {declared ? null : (
                      <Button size="sm" variant="ghost" disabled={isRefreshing} onClick={() => refreshServer(server.serverName)}>
                        {isRefreshing ? t('refreshing') : t('refresh')}
                      </Button>
                    )}
                    {declared && server.adoptable ? (
                      <Button size="sm" variant="ghost" disabled={adopting.has(server.serverName)} onClick={() => void runAdopt(server)}>
                        {adopting.has(server.serverName) ? t('adopting') : t('adopt')}
                      </Button>
                    ) : null}
                    {server.adopted ? (
                      <Button size="sm" variant="ghost" disabled={adopting.has(server.serverName)} onClick={() => void runAdopt(server)}>
                        {adopting.has(server.serverName) ? t('releasing') : t('release')}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={isExpanded ? <IconChevronDownOutlineRegular /> : <IconChevronRightOutlineRegular />}
                      onClick={() => toggleExpand(server.serverName)}
                    >
                      {isExpanded ? t('toolsCollapse') : t('toolsExpand')}
                    </Button>
                    {declared ? null : (
                      <Button size="sm" variant="ghost" onClick={() => beginEdit(server)}>{t('edit')}</Button>
                    )}
                  </div>
                </div>
                {isExpanded ? (
                  <div className={css.mcpToolPanel}>
                    {tools === null ? (
                      <p className={css.mcpMuted}>{toolsError ?? t('toolsLoading')}</p>
                    ) : serverToolList.length === 0 ? (
                      <p className={css.mcpMuted}>{t('toolsEmpty')}</p>
                    ) : (
                      <div className={css.mcpToolGrid}>
                        {serverToolList.map(tool => (
                          <Checkbox
                            key={tool.name}
                            className={css.mcpToolCheck}
                            checked={tool.enabled}
                            onChange={() => toggleTool(tool)}
                            label={rawOf(tool.name)}
                            title={tool.name}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </li>
            )
            // Editing this server: expand the form right below its row so the
            // user never has to scroll away to find it.
            if (state.draft !== null && state.draft.id === server.id) {
              return [card, <li key={`${server.id}-form`} className={css.mcpInlineFormItem}>{inlineForm}</li>]
            }
            return [card]
          })}
        </ul>
        )}
      </div>

      <Modal
        open={creating}
        headless
        onClose={closeCreate}
        title={t('newTitle')}
        className={css.mcpCreateDialog}
      >
        {/* Headless on purpose: the primitive's titled layout is sized for a
            confirm prompt, while this dialog holds the preset row plus the
            whole server form. The same arrangement as the app's own
            PresetGuideDialog — fixed header, one scrolling body — keeps the
            close button reachable however tall the form gets. Escape, the
            focus trap and focus restore still come from useModalLayer. */}
        <div className={css.mcpCreateLayout}>
          <div className={css.mcpCreateHeader}>
            <h2 className={css.mcpCreateTitle}>{t('newTitle')}</h2>
            <Button
              variant="ghost"
              className={css.mcpCreateClose}
              icon={<IconCloseOutlineRegular />}
              aria-label={t('cancel')}
              title={t('cancel')}
              onClick={closeCreate}
            />
          </div>
          <div className={css.mcpCreateBody}>
            <PresetPicker t={t} presets={visiblePresets} onPick={usePreset} />
            {presetNotice !== null ? <p className={css.mcpWarn} role="status">{presetNotice}</p> : null}
            {createForm}
          </div>
        </div>
      </Modal>
    </section>
  )
}
