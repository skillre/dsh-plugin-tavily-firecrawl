/**
 * Browser half of the Tavily + Firecrawl bundle: the configuration page that
 * lets keys be written where the plugin is configured instead of in an
 * environment variable or a file.
 *
 * Compiled to one CommonJS file and wrapped in the DSH client-module envelope
 * by `scripts/build-client.mjs`; the only runtime import is the baseline
 * `react` module served by the browser module table.
 *
 * Contracts consumed (read from the live DSH `0.2.0-rc.2` runtime; mirrored in
 * `./contracts.ts` rather than imported):
 * - `plugins.bundle.config` — keyed slot, key = this package's name, rendered
 *   on the bundle's page with `view: 'page'`;
 * - services `slots`, `locale` and the `remote.credentials` namespace.
 *
 * The page is registered unconditionally: it writes credentials rather than
 * reading this entry's settings form, and this module only loads when its own
 * bundle is active, so a loaded module is always a mounted plugin.
 *
 * @module @skillre/dsh-plugin-tavily-firecrawl/client
 */

import type { ClientContext } from './contracts.js'
import { createCredentialPage } from './view.js'

/** Service names this module cannot run without (mirrors the shipped pages). */
export const inject = ['slots', 'locale', 'remote', 'remote.credentials']

/** Slot the Plugins page dispatches a bundle's own configuration into. */
const BUNDLE_CONFIG_SLOT = 'plugins.bundle.config'

/** Package name: also the key this bundle's configuration is registered under. */
const PACKAGE_NAME = '@skillre/dsh-plugin-tavily-firecrawl'

/** Dictionary namespace owned by this page. */
const NS = 'skillre-tavily-firecrawl'

/** English dictionary for the page. */
const en: Record<string, string> = {
  intro: 'Keys are stored in the credentials store, outside the profile configuration, and resolve per request. Supply several to rotate across accounts; the environment variable names work unchanged.',
  'field.tavily': 'Tavily API keys',
  'field.tavily.hint': 'Read from TAVILY_API_KEYS (or TAVILY_API_KEY) when nothing is stored here.',
  'field.firecrawl': 'Firecrawl API keys',
  'field.firecrawl.hint': 'Read from FIRECRAWL_API_KEYS (or FIRECRAWL_API_KEY) when nothing is stored here.',
  'field.placeholder': 'key-1, key-2, key-3',
  'status.configured': 'Key stored',
  'status.missing': 'No key stored',
  'status.readonly': 'Supplied by the environment; edit it there',
  'action.save': 'Save',
  'action.discard': 'Discard',
  'action.clear': 'Remove the stored key',
  'notice.saved': 'Saved. The next search or fetch uses it — no restart.',
  'notice.cleared': 'Stored key removed. The environment still answers if it defines one.',
  'notice.failed': 'Could not save the key. The Host refused the write.',
  'notice.empty': 'Nothing to save: type at least one key first.',
}

/** Chinese dictionary for the page. */
const zh: Record<string, string> = {
  intro: '密钥保存在凭据存储中（不写进 profile 配置），每次请求实时读取。填写多个即可轮询多个账号；环境变量的写法继续有效。',
  'field.tavily': 'Tavily API Key',
  'field.tavily.hint': '此处未保存时，从 TAVILY_API_KEYS（或 TAVILY_API_KEY）读取。',
  'field.firecrawl': 'Firecrawl API Key',
  'field.firecrawl.hint': '此处未保存时，从 FIRECRAWL_API_KEYS（或 FIRECRAWL_API_KEY）读取。',
  'field.placeholder': 'key-1, key-2, key-3',
  'status.configured': '已保存密钥',
  'status.missing': '尚未保存密钥',
  'status.readonly': '由环境变量提供，请在环境中修改',
  'action.save': '保存',
  'action.discard': '放弃',
  'action.clear': '清除已保存的密钥',
  'notice.saved': '已保存。下次搜索/抓取即生效，无需重启。',
  'notice.cleared': '已清除保存的密钥；若环境变量里有，仍会从环境读取。',
  'notice.failed': '保存失败：Host 拒绝了这次写入。',
  'notice.empty': '没有可保存的内容：请先填写至少一个 Key。',
}

/**
 * Mount the configuration page.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, 'en', en), 'skillre-tavily-firecrawl: en dictionary')
  ctx.effect(() => ctx.locale.register(NS, 'zh', zh), 'skillre-tavily-firecrawl: zh dictionary')

  const page = createCredentialPage({ ctx, translate: t })
  ctx.effect(
    () => ctx.slots.inject(BUNDLE_CONFIG_SLOT, () =>
      ctx.slots.register({ name: BUNDLE_CONFIG_SLOT, key: PACKAGE_NAME }, page)),
    'skillre-tavily-firecrawl: configuration page',
  )
}
