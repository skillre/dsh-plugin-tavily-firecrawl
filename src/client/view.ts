/**
 * The bundle's configuration page: two credential fields, one per provider.
 *
 * The page writes into the **credentials domain**, never into the settings
 * document or the plugin row's config, so the literal key is stored outside
 * the profile patch, never rides a settings response, and never appears in
 * `dsh --dump-config`. What the Host resolves is a *reference*
 * (`TAVILY_API_KEYS` / `FIRECRAWL_API_KEYS`) whose value already layers the
 * inherited environment over the stored one — the same names an environment
 * deployment uses today, so both ways of supplying keys keep working.
 *
 * A field holds one line of comma-, semicolon- or whitespace-separated keys on
 * purpose: the pool rotates over all of them, so several free accounts can be
 * listed exactly as `TAVILY_API_KEYS` would be.
 *
 * Styling uses only `--dsw-alias-*` theme tokens and plugin-prefixed classes;
 * the sheet ships as a `<style>` element the renderer removes on unmount, so
 * nothing outlives the page.
 *
 * @module @skillre/dsh-plugin-tavily-firecrawl/client/view
 */

import { createElement, useEffect, useState, type ReactElement } from 'react'
import type { ClientContext, CredentialInfoView, PluginConfigViewProps } from './contracts.js'

/** `createElement` under a short local name: the Client half avoids JSX. */
const h = createElement

/** Tavily credential reference this page writes; mirrors the Host constant. */
export const TAVILY_REF = 'TAVILY_API_KEYS'

/** Firecrawl credential reference this page writes; mirrors the Host constant. */
export const FIRECRAWL_REF = 'FIRECRAWL_API_KEYS'

/** Every reference this page manages. */
const REFS = [TAVILY_REF, FIRECRAWL_REF] as const

/** Page stylesheet: theme tokens only, plugin-prefixed selectors. */
export const PAGE_CSS = `
.skafc-page { display: flex; flex-direction: column; gap: 18px; max-width: 640px; }
.skafc-intro { margin: 0; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.skafc-field { display: flex; flex-direction: column; gap: 6px; }
.skafc-label { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.skafc-hint { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.skafc-status { font-size: 12px; font-weight: 600; }
.skafc-status--ok { color: var(--dsw-alias-state-success-primary); }
.skafc-status--missing { color: var(--dsw-alias-state-warn-primary); }
.skafc-status--readonly { color: var(--dsw-alias-state-error-primary); }
.skafc-input {
  box-sizing: border-box; width: 100%; min-height: 76px; resize: vertical;
  padding: 8px 10px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.skafc-input:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.skafc-input:disabled { opacity: 0.6; }
.skafc-clear {
  align-self: flex-start; padding: 0; border: none; background: none;
  font-size: 12px; cursor: pointer; color: var(--dsw-alias-state-error-primary);
}
.skafc-clear:disabled { cursor: default; opacity: 0.6; }
.skafc-actions { display: flex; align-items: center; gap: 10px; }
.skafc-btn {
  padding: 6px 14px; border-radius: 8px; font-size: 13px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
}
.skafc-btn--primary {
  border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-brand-primary);
}
.skafc-btn:disabled { cursor: default; opacity: 0.6; }
.skafc-notice { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.skafc-notice--error { color: var(--dsw-alias-state-error-primary); }
`

/** How one reference stands, as the Host reports it. */
interface CredentialStatus {
  readonly configured: boolean
  readonly writable: boolean
}

/** Parse what the user typed into the canonical one-line credential list. */
function toCredentialList(text: string): string {
  return text.split(/[\s,;]+/).filter((part) => part.length > 0).join(',')
}

/** Props the factory binds: the browser context and the page dictionary. */
export interface CredentialPageProps {
  readonly ctx: ClientContext
  readonly translate: (key: string) => string
}

/**
 * Build the configuration page component.
 * @param props - the browser context and the dictionary binding.
 * @returns a component suitable for `ctx.slots.register`.
 */
export function createCredentialPage(bindings: CredentialPageProps): (props: PluginConfigViewProps) => ReactElement | null {
  const { ctx, translate: t } = bindings
  const status: Record<string, CredentialStatus> = {}
  for (const ref of REFS) status[ref] = { configured: false, writable: true }

  /** Re-read the credential state; the values themselves never leave the Host. */
  const read = async (apply: (next: Record<string, CredentialInfoView>) => void): Promise<void> => {
    const response = await ctx.remote.credentials.describe([...REFS])
    if (response.ok) apply(response.value)
  }

  return function CredentialPage(props: PluginConfigViewProps): ReactElement | null {
    const [staged, setStaged] = useState<Record<string, string>>({ [TAVILY_REF]: '', [FIRECRAWL_REF]: '' })
    const [state, setState] = useState<Record<string, CredentialStatus>>({ ...status })
    const [busy, setBusy] = useState(false)
    const [notice, setNotice] = useState<{ readonly text: string, readonly kind: 'info' | 'error' }>({ text: '', kind: 'info' })

    useEffect(() => {
      let active = true
      // The renderer owns this page's lifetime; a set after unmount is dropped
      // rather than scheduled back onto a dead tree.
      void read((value) => {
        if (!active) return
        setState({ ...status, ...toStatus(value) })
      })
      return () => { active = false }
    }, [])

    if (props.view !== 'page') return null

    const stagedKeys = (ref: string): string => staged[ref] ?? ''
    const disabled = busy || Object.values(state).every((entry) => !entry.writable)

    const save = async (): Promise<void> => {
      const writes = REFS
        .map((ref) => [ref, toCredentialList(stagedKeys(ref))] as const)
        .filter(([, value]) => value.length > 0)
      if (writes.length === 0) {
        setNotice({ text: t('notice.empty'), kind: 'info' })
        return
      }
      setBusy(true)
      setNotice({ text: '', kind: 'info' })
      try {
        for (const [ref, value] of writes) await ctx.remote.credentials.set(ref, value)
        setStaged({ [TAVILY_REF]: '', [FIRECRAWL_REF]: '' })
        await read((value) => setState({ ...status, ...toStatus(value) }))
        setNotice({ text: t('notice.saved'), kind: 'info' })
      } catch {
        setNotice({ text: t('notice.failed'), kind: 'error' })
      } finally {
        setBusy(false)
      }
    }

    const clear = async (ref: string): Promise<void> => {
      setBusy(true)
      setNotice({ text: '', kind: 'info' })
      try {
        await ctx.remote.credentials.unset(ref)
        await read((value) => setState({ ...status, ...toStatus(value) }))
        setNotice({ text: t('notice.cleared'), kind: 'info' })
      } catch {
        setNotice({ text: t('notice.failed'), kind: 'error' })
      } finally {
        setBusy(false)
      }
    }

    const discard = (): void => {
      setStaged({ [TAVILY_REF]: '', [FIRECRAWL_REF]: '' })
      setNotice({ text: '', kind: 'info' })
    }

    return h('div', { className: 'skafc-page' },
      h('style', {}, PAGE_CSS),
      h('p', { className: 'skafc-intro' }, t('intro')),
      field({
        ref: TAVILY_REF,
        label: t('field.tavily'),
        hint: t('field.tavily.hint'),
        state: state[TAVILY_REF] ?? { configured: false, writable: true },
        value: stagedKeys(TAVILY_REF),
        busy,
        onChange: (text) => setStaged((current) => ({ ...current, [TAVILY_REF]: text })),
        onClear: () => { void clear(TAVILY_REF) },
        t,
      }),
      field({
        ref: FIRECRAWL_REF,
        label: t('field.firecrawl'),
        hint: t('field.firecrawl.hint'),
        state: state[FIRECRAWL_REF] ?? { configured: false, writable: true },
        value: stagedKeys(FIRECRAWL_REF),
        busy,
        onChange: (text) => setStaged((current) => ({ ...current, [FIRECRAWL_REF]: text })),
        onClear: () => { void clear(FIRECRAWL_REF) },
        t,
      }),
      h('div', { className: 'skafc-actions' },
        h('button', { type: 'button', className: 'skafc-btn skafc-btn--primary', disabled, onClick: () => { void save() } }, t('action.save')),
        h('button', { type: 'button', className: 'skafc-btn', disabled: busy, onClick: discard }, t('action.discard')),
        notice.text.length > 0
          ? h('span', { className: notice.kind === 'error' ? 'skafc-notice skafc-notice--error' : 'skafc-notice' }, notice.text)
          : null,
      ),
    )
  }
}

/** Narrow the wire's credential view into the page's status map. */
function toStatus(value: Record<string, CredentialInfoView>): Record<string, CredentialStatus> {
  const next: Record<string, CredentialStatus> = {}
  for (const ref of REFS) {
    next[ref] = {
      configured: value[ref]?.configured ?? false,
      writable: value[ref]?.writable ?? true,
    }
  }
  return next
}

/** One credential field: label, state line, hint and the staged textarea. */
function field(options: {
  readonly ref: string
  readonly label: string
  readonly hint: string
  readonly state: CredentialStatus
  readonly value: string
  readonly busy: boolean
  readonly onChange: (text: string) => void
  readonly onClear: () => void
  readonly t: (key: string) => string
}): ReactElement {
  const { label, hint, state, value, busy, onChange, onClear, t } = options
  const kind = !state.writable ? 'readonly' : state.configured ? 'ok' : 'missing'
  const text = !state.writable ? t('status.readonly') : state.configured ? t('status.configured') : t('status.missing')
  return h('div', { className: 'skafc-field' },
    h('span', { className: 'skafc-label' }, label),
    h('span', { className: `skafc-status skafc-status--${kind}` }, text),
    h('textarea', {
      className: 'skafc-input',
      value,
      rows: 3,
      spellCheck: false,
      autoComplete: 'off',
      placeholder: t('field.placeholder'),
      disabled: busy || !state.writable,
      onChange: (event: { target?: { value?: string } }) => onChange(event.target?.value ?? ''),
    }),
    h('span', { className: 'skafc-hint' }, hint),
    state.configured && state.writable
      ? h('button', { type: 'button', className: 'skafc-clear', disabled: busy, onClick: onClear }, t('action.clear'))
      : null,
  )
}
