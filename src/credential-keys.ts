/**
 * `CredentialKeys`: one provider's live credential list.
 *
 * The list has three planes, in the order the fleet documents them:
 *
 *   1. **configuration** — `search.apiKeys` / `search.apiKey` in the plugin row,
 *      written once per deployment and always authoritative;
 *   2. **the credentials domain** — a credential *reference* (an
 *      environment-variable-shaped name such as `TAVILY_API_KEYS`) that the
 *      `credentials` service resolves across its own layers, so a key written
 *      from the plugin's configuration card reaches the next request without a
 *      restart;
 *   3. **the launch environment** — the same names read from the process /
 *      `.env` snapshot, which is the whole credential plane when a composition
 *      runs without the credentials service.
 *
 * Planes 2 and 3 resolve the *same* names, so nothing about an existing
 * environment or `.env` deployment changes: the credentials service already
 * layers the inherited environment over its own store. What is new is that the
 * list is no longer frozen at load — {@link CredentialKeys.refresh} re-reads it
 * at request start, and {@link KeyPool.reconcile} carries each credential's
 * cooldown state across that re-read.
 *
 * The synchronous plane is always populated (from configuration or the launch
 * environment) so `available()` can be answered without awaiting anything;
 * the first credentials read runs in the background and is observable through
 * {@link KeySource.isWarming}.
 * @module @skillre/dsh-plugin-tavily-firecrawl/credential-keys
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type { KeySource } from './key-pool.js'
import { parseKeyList } from './key-pool.js'

/** Construction options for {@link CredentialKeys}. */
export interface CredentialKeysOptions {
  /**
   * Keys spelled in configuration, read on every refresh so a committed
   * settings change reaches the next request; they win over every reference.
   */
  readonly configured?: (() => readonly string[]) | undefined
  /** The plural credential reference, e.g. `TAVILY_API_KEYS`. */
  readonly ref: string
  /** The singular credential reference, e.g. `TAVILY_API_KEY`. */
  readonly singularRef: string
}

/**
 * The grammar a credential reference must satisfy: a POSIX shell identifier.
 * Mirrored from the `credentials` seam so a bad ref fails here, loudly and
 * before any request, instead of reading back as "not set".
 */
const REFERENCE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * The credentials service face this package consumes, mirrored structurally
 * rather than imported: the seam is optional (a composition without it falls
 * back to the launch environment), and pulling its package in would make a
 * peer dependency out of an optional runtime. The shape is the live
 * `credentials` Service contract (`resolve(ref) -> ResolvedCredential |
 * undefined`, the value under `value`).
 */
interface CredentialsLike {
  resolve(ref: string): Promise<{ readonly value?: unknown } | undefined>
}

/** Read `ctx.get('credentials')` through the mirrored face; `undefined` when the composition has none. */
function credentialsOf(ctx: Context): CredentialsLike | undefined {
  const lookup = ctx.get as unknown as (name: string) => unknown
  const service = lookup('credentials')
  return typeof service === 'object' && service !== null && 'resolve' in service
    ? service as CredentialsLike
    : undefined
}

/**
 * Resolve one reference through the credentials service, reading its value as
 * one credential list (plural form) or one credential (singular form).
 * @param service - the credentials service, or `undefined` when absent.
 * @param ref - the reference to resolve.
 * @param list - whether the value is a list rather than a single credential.
 * @returns the parsed credentials, or `undefined` when the reference is unset.
 */
async function resolveReference(service: CredentialsLike, ref: string, list: boolean): Promise<string[] | undefined> {
  const resolved = await service.resolve(ref)
  const value = resolved?.value
  if (typeof value !== 'string') return undefined
  const keys = list ? parseKeyList(value) : [value.trim()].filter((key) => key.length > 0)
  return keys.length > 0 ? keys : undefined
}

/**
 * Read the launch-environment half of the credential plane: the plural name
 * wins over the singular one, so a list can be added without disturbing a
 * deployed single-key setup.
 * @param ctx - the plugin context.
 * @param ref - the plural name.
 * @param singularRef - the singular name.
 * @returns the credentials the launch provides, possibly empty.
 */
function environmentKeys(ctx: Context, ref: string, singularRef: string): string[] {
  const environment = launchEnvironmentOf(ctx)
  const listed = parseKeyList(environment.get(ref)?.value)
  if (listed.length > 0) return listed
  const single = environment.get(singularRef)?.value
  if (typeof single !== 'string') return []
  const trimmed = single.trim()
  return trimmed.length > 0 ? [trimmed] : []
}

/**
 * Subscribe to an event whose name lives in another package's type
 * augmentation (`credentials/reference-updated` from the credentials seam,
 * `loader/volatile-update` from the plugin loader), which this package does
 * not import because both are optional at runtime. The names and payloads come
 * from the live Event catalog rather than from memory; a runtime that never
 * emits one simply never calls the listener. Like every `ctx.on` registration,
 * the listener belongs to the calling fiber.
 * @param ctx - the plugin context.
 * @param event - the event name.
 * @param listener - called with the dispatch arguments.
 * @returns a disposer removing the listener.
 */
function subscribe(ctx: Context, event: string, listener: (argument: unknown) => void): () => void {
  const on = ctx.on as unknown as (name: string, handler: (argument: unknown) => void) => () => void
  return on(event, listener)
}

/** Trim and drop blanks from an explicitly configured list. */
function configuredKeys(read: (() => readonly string[]) | undefined): string[] {
  return (read?.() ?? []).map((key) => key.trim()).filter((key) => key.length > 0)
}

/**
 * Read one configuration value that may be a live reference.
 *
 * A field marked `.volatile()` in the Config schema arrives as a `Volatile<T>`
 * reference (`{ get() }`) on a runtime that commits volatile config into the
 * running fiber, and as a plain value on one that does not — or when a test
 * parses the schema directly. Reading through this helper keeps the plugin
 * correct on both, which is what lets one build serve every line in
 * `engines.dsh`.
 * @param value - the raw configuration value.
 * @returns the current value, or `undefined` when absent.
 */
export function readVolatile<T>(value: unknown): T | undefined {
  if (typeof value === 'object' && value !== null) {
    const candidate = value as { get?: unknown }
    if (typeof candidate.get === 'function') return (candidate.get as () => T)()
  }
  return value as T | undefined
}

/**
 * One provider's credential list, resolvable from configuration, the
 * credentials domain, or the launch environment — in that order.
 */
export class CredentialKeys implements KeySource {
  /** The keys in force as of the last refresh. */
  private keys: string[]

  /** Whether the first credentials read has not settled. */
  private warming = false

  /** The in-flight credentials read, shared by concurrent refreshes. */
  private pending: Promise<readonly string[]> | undefined

  /** Listeners notified whenever a refresh settles with the list now in force. */
  private readonly observers = new Set<(keys: readonly string[]) => void>()

  /**
   * @param ctx - the plugin context.
   * @param options - the references to resolve and the configured keys.
   */
  constructor(private readonly ctx: Context, private readonly options: CredentialKeysOptions) {
    for (const [label, ref] of [['ref', options.ref], ['singularRef', options.singularRef]] as const) {
      if (!REFERENCE_PATTERN.test(ref)) throw new TypeError(`credential ${label} "${ref}" must match ${String(REFERENCE_PATTERN)}`)
    }
    // The synchronous plane: configuration wins, otherwise the launch
    // environment, which is also what the credentials service resolves first.
    this.keys = this.configured()
      ?? environmentKeys(ctx, options.ref, options.singularRef)
  }

  /** The keys in force as of the last refresh. */
  current(): readonly string[] {
    return this.keys
  }

  /** Whether the first credentials read has not settled yet. */
  isWarming(): boolean {
    return this.warming
  }

  /**
   * Re-read the credential plane. Concurrent callers share one read, a
   * configured list short-circuits it, and a composition without the
   * credentials service keeps the launch environment authoritative.
   * @returns the keys now in force.
   */
  refresh(): Promise<readonly string[]> {
    const configured = this.configured()
    if (configured !== undefined) {
      this.keys = configured
      this.publish()
      return Promise.resolve(this.keys)
    }
    this.pending ??= this.read()
    return this.pending
  }

  /**
   * Observe every settled refresh, so a pool built from the first list follows
   * later ones without polling. The listener is not primed with the current
   * list — {@link current} serves the initial build — and the returned
   * disposer detaches it.
   * @param listener - called with the list a refresh settled with.
   * @returns a disposer removing the listener.
   */
  observe(listener: (keys: readonly string[]) => void): () => void {
    this.observers.add(listener)
    return () => { this.observers.delete(listener) }
  }

  /**
   * Watch what can change this list: the credential references this source
   * resolves (so a key written from the plugin's configuration page reaches
   * the pool without waiting for the next request) and the loader's volatile
   * config commit (so a key set through the configuration form does the same).
   * Both listeners are owned by the calling fiber; the returned disposer
   * detaches them early.
   * @returns a disposer removing the listeners.
   */
  watch(): () => void {
    const onCredential = (ref: unknown): void => {
      if (ref === this.options.ref || ref === this.options.singularRef) void this.refresh()
    }
    const onConfig = (): void => { void this.refresh() }
    const stopCredential = subscribe(this.ctx, 'credentials/reference-updated', onCredential)
    // Emitted by the loader when it commits a volatile-only config change into
    // this fiber's references; a runtime without volatile support never fires
    // it, and the listener is harmless there.
    const stopConfig = subscribe(this.ctx, 'loader/volatile-update', onConfig)
    return () => {
      stopCredential()
      stopConfig()
    }
  }

  /** Configured keys when the deployment spelled any, otherwise `undefined`. */
  private configured(): string[] | undefined {
    const keys = configuredKeys(this.options.configured)
    return keys.length > 0 ? keys : undefined
  }

  /** Read one reference (plural first) through the credentials service. */
  private async read(): Promise<readonly string[]> {
    this.warming = true
    try {
      const service = credentialsOf(this.ctx)
      if (service === undefined) {
        // No credentials service: the launch environment is the whole plane.
        this.keys = environmentKeys(this.ctx, this.options.ref, this.options.singularRef)
        return this.keys
      }
      const keys = await resolveReference(service, this.options.ref, true)
        ?? await resolveReference(service, this.options.singularRef, false)
        ?? []
      this.keys = keys
      return this.keys
    } finally {
      this.warming = false
      this.pending = undefined
      this.publish()
    }
  }

  /** Hand the list now in force to every attached observer, contained per listener. */
  private publish(): void {
    for (const listener of [...this.observers]) listener(this.keys)
  }
}
