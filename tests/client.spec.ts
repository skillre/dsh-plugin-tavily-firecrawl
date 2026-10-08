/**
 * Browser-half tests: run the built client bundle the way the shell does, then
 * render the page it registers.
 *
 * These are the tests that answer "why is there no place to enter a key?": the
 * Plugins page renders the bundle's configuration section only when a slot
 * entry claims `<package name>` in `plugins.bundle.config` (`configured ? … :
 * null` in the plugin-manager page), so a bundle that never registers — because
 * `apply` threw, or because the key was wrong — shows nothing at all. Loading
 * the envelope, calling `apply` against a stub context and rendering the
 * component proves the whole path without a browser.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { createElement, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  name: string
  exports: Record<string, unknown>
}

/** What a registered page component accepts and returns. */
type PageComponent = (props: { readonly view?: string }) => ReactElement | null

/** One registration the stub slot registry captured. */
interface Registration {
  readonly options: { readonly name?: string, readonly key?: string, readonly id?: string }
  readonly component: PageComponent
}

/** What `lib/client.js` exposes after its envelope runs. */
interface ClientModule {
  readonly inject?: readonly string[]
  readonly apply?: (ctx: unknown) => void
}

/** A registration-free stand-in for the Client context this page reads. */
function fakeClientContext() {
  const registrations: Registration[] = []
  const dictionaries: { namespace: string, locale: string, dict: Record<string, string> }[] = []
  const ctx = {
    effect(body: () => unknown) {
      return body()
    },
    slots: {
      inject(_slot: string, callback: () => unknown) {
        const disposer = callback()
        return typeof disposer === 'function' ? disposer : () => {}
      },
      register(options: Registration['options'], component: Registration['component']) {
        registrations.push({ options, component })
        return () => {}
      },
    },
    locale: {
      // Resolve lazily: `apply` binds before it registers the dictionaries,
      // exactly as the shipped pages do, so the lookup must run at render time.
      bind(namespace: string) {
        return (key: string) => dictionaries
          .find((entry) => entry.namespace === namespace && entry.locale === 'en')
          ?.dict[key] ?? key
      },
      register(namespace: string, locale: string, dict: Record<string, string>) {
        dictionaries.push({ namespace, locale, dict })
        return () => {}
      },
    },
    remote: {
      credentials: {
        describe: async () => ({ ok: true, value: {} }),
        set: async () => ({ ok: true }),
        unset: async () => ({ ok: true }),
      },
    },
  }
  return { ctx, registrations, dictionaries }
}

/** Evaluate `lib/client.js` exactly as `window.__ModuleLoader__` does. */
function loadClient(): ClientModule {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const loads: { id: string, factory: (require: (id: string) => unknown) => unknown }[] = []
  const window = {
    __ModuleLoader__: {
      load(entry: { id: string, factory: (require: (id: string) => unknown) => unknown }) {
        loads.push(entry)
      },
    },
  }
  // eslint-disable-next-line no-new-func -- the shell evaluates the same source
  new Function('window', source)(window)
  expect(loads, 'the envelope must call window.__ModuleLoader__.load').toHaveLength(1)
  const [loaded] = loads
  expect(loaded?.id, 'the envelope id must equal the package name').toBe(manifest.name)
  const require_ = createRequire(import.meta.url)
  return loaded?.factory((id: string) => require_(id)) as ClientModule
}

describe('browser half', () => {
  it('registers one configuration page under the bundle package name', () => {
    const client = loadClient()
    expect(client.inject).toEqual(['slots', 'locale', 'remote', 'remote.credentials'])
    expect(client.apply).toBeTypeOf('function')

    const harness = fakeClientContext()
    client.apply?.(harness.ctx)

    expect(harness.registrations, 'exactly one slot contribution').toHaveLength(1)
    const [registration] = harness.registrations
    expect(registration?.options).toEqual({
      name: 'plugins.bundle.config',
      key: manifest.name,
    })
    expect(registration?.component, 'a component must be handed to the slot').toBeTypeOf('function')

    // The Plugins page dispatches by package name, so the key above must be
    // the one it asks for; dictionaries must exist for both shipped locales
    // under one namespace, which is also what `bind` resolves against.
    expect(harness.dictionaries.map((entry) => entry.locale).sort()).toEqual(['en', 'zh'])
    expect(new Set(harness.dictionaries.map((entry) => entry.namespace)).size).toBe(1)
  })

  it('renders the key form on the page view', () => {
    const client = loadClient()
    const harness = fakeClientContext()
    client.apply?.(harness.ctx)

    const html = renderToString(createElement(harness.registrations[0]!.component, { view: 'page' }))
    expect(html, 'both credential fields render').toMatch(/Tavily API keys[\s\S]*Firecrawl API keys/)
    expect(html.match(/<textarea/g) ?? [], 'one textarea per provider').toHaveLength(2)
    expect(html, 'the save control is present').toContain('Save')
    expect(html, 'the intro explains where keys are stored').toContain('credentials store')
    expect(html, 'styles use theme tokens only').toContain('--dsw-alias-')
    expect(html, 'no raw data-* attribute slips into createElement props')
      .not.toMatch(/data-(kind|ref|primary)=/)
  })

  it('renders nothing for the summary view', () => {
    const client = loadClient()
    const harness = fakeClientContext()
    client.apply?.(harness.ctx)

    const html = renderToString(createElement(harness.registrations[0]!.component, { view: 'summary' }))
    expect(html).toBe('')
  })
})
