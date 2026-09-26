/**
 * Process-level environment-variable editor: a global key-value list shared
 * by every MCP server's header substitution. Values are referenced from
 * server headers as `${NAME}` or by bare name; secret values are stored in
 * the credentials document and never shown back.
 *
 * The table is rendered as a read-only list of rows plus two dialogs (add/edit
 * one variable, and paste many). Editing through a dialog keeps the row itself
 * a plain summary, so the common case — scanning what is configured — needs no
 * input fields at all.
 *
 * Every row operation writes through immediately: `envSet` REPLACES the whole
 * table, so each add, edit, bulk paste and removal re-sends the full list and
 * the host's answer becomes the new state. There is deliberately no save
 * button — a staged edit the user forgets to commit is indistinguishable from
 * a lost one.
 * @module dsh-mcp/client/GlobalEnvEditor
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Button, Checkbox, Modal, Tag,
  IconCloseOutlineRegular, IconEditOutlineRegular, IconPlusOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { McpEnvVarView } from './types.ts'
import type { McpSettingsLocaleKey } from './locales.ts'
import css from './GlobalEnvEditor.module.css'

/** One draft row in the list; `configured` marks a value already stored. */
interface EnvRowDraft {
  readonly key: string
  name: string
  secret: boolean
  value: string
  configured: boolean
}

/** One variable in the `envSet` payload. */
interface EnvVarPayload {
  name: string
  secret?: boolean
  value?: string
}

/** Host Remote face required by the editor. */
export interface GlobalEnvRemote {
  /** Read the process-level env rows. */
  envList: () => Promise<{ vars: readonly McpEnvVarView[] }>
  /** Replace the whole process-level env table. */
  envSet: (vars: readonly { name: string; secret?: boolean; value?: string }[]) => Promise<{ vars: readonly McpEnvVarView[] }>
}

/** Props for the process env editor panel. */
export interface GlobalEnvEditorProps {
  readonly injected: GlobalEnvRemote
  readonly t: (key: McpSettingsLocaleKey) => string
  /** Called after a successful save; the parent refreshes the page. */
  readonly onApplied: () => void
}

/** Server-side rule for a usable variable name. */
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

let rowSeq = 0
function nextKey(): string {
  rowSeq += 1
  return `genv-${rowSeq}`
}

/** Map a Host view into a draft row (a secret value is never sent back). */
function toRow(row: McpEnvVarView): EnvRowDraft {
  return {
    key: nextKey(),
    name: row.name,
    secret: row.secret,
    value: row.secret ? '' : (row.value ?? ''),
    configured: row.configured,
  }
}

/** The single-variable dialog's own state. */
interface EditorState {
  /** Row key being edited, or null when adding a new variable. */
  readonly target: string | null
  name: string
  value: string
  secret: boolean
  error: string | null
}

/** Render the process-level environment-variable editor panel. */
export function GlobalEnvEditor({ injected, t, onApplied }: GlobalEnvEditorProps): ReactNode {
  const [rows, setRows] = useState<EnvRowDraft[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const seqRef = useRef(0)

  const reload = (): void => {
    const seq = ++seqRef.current
    setLoadFailed(false)
    void injected.envList().then(
      (state) => {
        if (seq !== seqRef.current) return
        setRows(state.vars.map(toRow))
        setLoaded(true)
        setError(null)
      },
      (error: unknown) => {
        if (seq !== seqRef.current) return
        setLoadFailed(true)
        setError(error instanceof Error ? error.message : String(error))
      },
    )
  }

  useEffect(() => {
    if (loaded) return
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injected, loaded])

  /**
   * Serialize rows into the `envSet` payload.
   *
   * A blank value is omitted rather than sent empty: for a secret that means
   * "keep the stored value", which is the only way to re-save a table whose
   * secrets are never echoed back to this component.
   * @returns the payload, or an error message when a row is not usable.
   */
  const toPayload = (source: readonly EnvRowDraft[]): { vars: EnvVarPayload[] } | { error: string } => {
    const vars: EnvVarPayload[] = []
    const seen = new Set<string>()
    for (const row of source) {
      const name = row.name.trim()
      if (name.length === 0) {
        if (row.value.trim().length > 0) return { error: t('globalEnvNameRequired') }
        continue // 空行跳过
      }
      if (!NAME_RE.test(name)) return { error: t('globalEnvNameInvalid') }
      if (seen.has(name)) return { error: t('globalEnvNameDuplicate') }
      seen.add(name)
      vars.push({
        name,
        secret: row.secret,
        ...(row.value.trim().length > 0 ? { value: row.value } : {}),
      })
    }
    return { vars }
  }

  /**
   * Write a row list to the host and adopt its answer as the new state.
   *
   * `envSet` replaces the whole table, so every operation routes through here
   * with the complete list — that is what makes add, edit and remove take
   * effect on their own, with no separate save step.
   * @param source - the full row list to persist.
   * @param done - message shown on success, or null to leave the notice alone.
   * @returns whether the write succeeded.
   */
  const commit = (source: readonly EnvRowDraft[], done: string | null): Promise<boolean> => {
    const payload = toPayload(source)
    if ('error' in payload) {
      setError(payload.error)
      setNotice(null)
      return Promise.resolve(false)
    }
    const seq = ++seqRef.current
    setBusy(true)
    setError(null)
    setNotice(null)
    return injected.envSet(payload.vars).then(
      (state) => {
        if (seq !== seqRef.current) return false
        setRows(state.vars.map(toRow))
        if (done !== null) setNotice(done)
        onApplied()
        return true
      },
      (error: unknown) => {
        if (seq !== seqRef.current) return false
        setError(error instanceof Error ? error.message : String(error))
        return false
      },
    ).finally(() => {
      if (seq === seqRef.current) setBusy(false)
    })
  }

  /**
   * Remove a row. The guard matters because every operation now writes
   * through: a second commit started from a stale `rows` snapshot would
   * re-add the row the first one is still removing.
   */
  const remove = (key: string): void => {
    if (busy) return
    void commit(rows.filter(row => row.key !== key), t('globalEnvRemoved'))
  }

  /** Open the dialog for a fresh variable. */
  const openAdd = (): void => {
    setEditor({ target: null, name: '', value: '', secret: true, error: null })
  }

  /** Open the dialog on an existing row (a secret value is never preloaded). */
  const openEdit = (row: EnvRowDraft): void => {
    setEditor({ target: row.key, name: row.name, value: '', secret: row.secret, error: null })
  }

  /**
   * Commit the dialog straight to the host. A stored row keeps its name: the
   * name is the credentials key, so renaming it here would orphan the stored
   * secret rather than move it.
   */
  const confirmEditor = (): void => {
    if (editor === null || busy) return
    const name = editor.name.trim()
    const isNew = editor.target === null
    if (name.length === 0) {
      setEditor({ ...editor, error: t('globalEnvNameRequired') })
      return
    }
    if (isNew && !NAME_RE.test(name)) {
      setEditor({ ...editor, error: t('globalEnvNameInvalid') })
      return
    }
    if (isNew && rows.some(row => row.name === name)) {
      setEditor({ ...editor, error: t('globalEnvNameDuplicate') })
      return
    }
    const value = editor.value
    const next = isNew
      ? [...rows, {
          key: nextKey(),
          name,
          secret: editor.secret,
          value,
          configured: value.trim().length > 0,
        }]
      : rows.map(row => row.key === editor.target
          ? {
              ...row,
              secret: editor.secret,
              ...(value.trim().length > 0 ? { value, configured: true } : {}),
            }
          : row)
    void commit(next, t('globalEnvDone')).then((ok) => {
      // Keep the dialog open on failure so the message stays next to the field.
      if (ok) setEditor(null)
    })
  }

  /**
   * Parse "NAME=value" lines (one per line) into fresh rows and persist them.
   *
   * A line carrying a value defaults to secret, because this dialog is mostly
   * used to paste a token and the two mistakes are not equally costly: marking
   * a plain value secret only routes it through the credentials document,
   * while marking a token plain would write it into the patch file in the
   * clear.
   */
  const applyBulk = (): void => {
    if (busy) return
    const parsed = bulkText.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0)
    if (parsed.length === 0) {
      setBulkOpen(false)
      return
    }
    const next: EnvRowDraft[] = [...rows]
    for (const line of parsed) {
      const eq = line.indexOf('=')
      if (eq <= 0) {
        next.push({ key: nextKey(), name: line, secret: false, value: '', configured: false })
        continue
      }
      const name = line.slice(0, eq).trim()
      const value = line.slice(eq + 1)
      if (name.length === 0) continue
      next.push({ key: nextKey(), name, secret: true, value, configured: true })
    }
    void commit(next, t('globalEnvDone')).then((ok) => {
      if (!ok) return
      setBulkOpen(false)
      setBulkText('')
    })
  }

  /** What the value column shows: a secret is never echoed back. */
  const valueText = (row: EnvRowDraft): string => {
    if (row.secret) return row.configured ? '••••••••' : t('globalEnvNotSet')
    return row.value.length > 0 ? row.value : t('globalEnvNotSet')
  }

  const editingRow = editor?.target != null ? rows.find(row => row.key === editor.target) : undefined

  return (
    <div className={css.genvPanel}>
      <p className={css.genvHint}>{t('globalEnvHint')}</p>
      {rows.length === 0 && !loadFailed ? <p className={css.genvMuted}>{t('globalEnvEmpty')}</p> : null}
      {rows.length > 0 ? (
        <ul className={css.genvList}>
          {rows.map(row => (
            <li key={row.key} className={css.genvRow}>
              <span className={css.genvNameCell}>
                <span className={css.genvName} title={row.name}>{row.name}</span>
                <Tag tone={row.secret ? 'info' : 'neutral'}>
                  {row.secret ? t('globalEnvSecret') : t('globalEnvPlain')}
                </Tag>
              </span>
              <span className={css.genvValue} title={valueText(row)}>{valueText(row)}</span>
              <span className={css.genvRowActions}>
                <Button
                  size="sm"
                  variant="ghost"
                  className={css.genvIconButton}
                  icon={<IconEditOutlineRegular />}
                  disabled={busy}
                  aria-label={t('globalEnvEdit')}
                  title={t('globalEnvEdit')}
                  onClick={() => openEdit(row)}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className={css.genvIconButton}
                  icon={<IconCloseOutlineRegular size={14} />}
                  disabled={busy}
                  aria-label={t('globalEnvRemove')}
                  title={t('globalEnvRemove')}
                  onClick={() => remove(row.key)}
                />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {loadFailed ? (
        <div className={css.genvRetryRow}>
          <span className={css.genvMuted}>{t('globalEnvLoadFailed')}</span>
          <Button size="sm" variant="outline" onClick={reload}>{t('globalEnvRetry')}</Button>
        </div>
      ) : null}
      {error !== null ? <p className={css.genvError}>{error}</p> : null}
      {notice !== null ? <p className={css.genvNotice}>{notice}</p> : null}
      <div className={css.genvActions}>
        <Button size="sm" variant="outline" icon={<IconPlusOutlineRegular />} onClick={openAdd} disabled={busy}>
          {t('globalEnvAdd')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)} disabled={busy}>{t('globalEnvBulk')}</Button>
      </div>

      <Modal
        open={editor !== null}
        onClose={() => { if (!busy) setEditor(null) }}
        title={editor?.target == null ? t('globalEnvAdd') : t('globalEnvEditTitle')}
        closeLabel={t('cancel')}
        className={css.genvDialog}
        contentClassName={css.genvDialogScroll}
        footer={(
          <>
            <Button size="sm" variant="ghost" onClick={() => setEditor(null)} disabled={busy}>{t('cancel')}</Button>
            <Button size="sm" variant="primary" onClick={confirmEditor} disabled={busy}>{t('globalEnvConfirm')}</Button>
          </>
        )}
      >
        {editor !== null ? (
          <div className={css.genvDialogFields}>
            <label className={css.genvDialogField}>
              <span>{t('globalEnvName')}</span>
              <input
                type="text"
                // The primitive focuses [data-modal-autofocus] through
                // useModalLayer, which also restores focus on close; React's
                // autoFocus would run first and defeat that restore.
                data-modal-autofocus
                spellCheck={false}
                value={editor.name}
                disabled={editingRow !== undefined}
                onChange={(event) => setEditor({ ...editor, name: event.currentTarget.value, error: null })}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); confirmEditor() } }}
              />
            </label>
            {editingRow !== undefined ? <p className={css.genvHint}>{t('globalEnvNameLocked')}</p> : null}
            <label className={css.genvDialogField}>
              <span>{t('globalEnvValue')}</span>
              <input
                type="text"
                spellCheck={false}
                value={editor.value}
                onChange={(event) => setEditor({ ...editor, value: event.currentTarget.value, error: null })}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); confirmEditor() } }}
              />
            </label>
            <p className={css.genvHint}>{t('globalEnvValueHint')}</p>
            <Checkbox
              checked={editor.secret}
              onChange={(next) => setEditor({ ...editor, secret: next, error: null })}
              label={t('globalEnvSecret')}
            />
            <p className={css.genvHint}>{t('globalEnvSecretHint')}</p>
            {editor.error !== null ? <p className={css.genvError}>{editor.error}</p> : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title={t('globalEnvBulk')}
        closeLabel={t('cancel')}
        description={t('globalEnvBulkPrompt')}
        className={css.genvDialog}
        contentClassName={css.genvDialogScroll}
        footer={(
          <>
            <Button size="sm" variant="ghost" onClick={() => setBulkOpen(false)} disabled={busy}>{t('cancel')}</Button>
            <Button size="sm" variant="primary" onClick={applyBulk} disabled={busy}>{t('globalEnvBulkOk')}</Button>
          </>
        )}
      >
        <textarea
          className={css.genvBulkText}
          rows={8}
          data-modal-autofocus
          spellCheck={false}
          value={bulkText}
          onChange={(event) => setBulkText(event.currentTarget.value)}
        />
      </Modal>
    </div>
  )
}
