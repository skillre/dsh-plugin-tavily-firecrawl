/**
 * Structural mirrors of the DSH Client contracts this bundle consumes.
 *
 * Mirrored rather than imported so the browser half pulls no part of the DSH
 * client package graph into its own build — the envelope resolves exactly one
 * module table, so a real import would either fail at runtime or have to be
 * externalized. Everything below was read from the live runtime (DSH
 * `0.2.0-rc.2`): the Client `Service` catalog for `slots` and `locale`, the
 * slot catalog entry for `plugins.bundle.config`, the `credentials` Remote
 * namespace, and the shipped `dsh-client-ui-settings-web-search` page, which
 * consumes the same shapes. Re-query before widening this surface, and treat a
 * mismatch as a compatibility finding rather than a reason to loosen the
 * mirror.
 *
 * @module @skillre/dsh-plugin-tavily-firecrawl/client/contracts
 */

/** One teardown callback returned by every registration. */
export type Disposer = () => void

/**
 * Component type the slot registry mounts. The owner constructs the props, so
 * this package only ever hands a component over: `never` keeps any typed
 * component assignable without widening what the registry may call.
 */
export type SlotComponent = (props: never) => unknown

/** Registration options a slot entry accepts. */
export interface SlotRegisterOptions {
  /** Target slot name, e.g. `plugins.bundle.config`. */
  readonly name: string
  /** Cell key for a keyed slot; the owner dispatches this exact string. */
  readonly key?: string
  /** Cell id for a list slot. */
  readonly id?: string
  /** Ascending position among the entries. */
  readonly order?: number
  /** Display text where the owner projects one; a thunk follows the locale. */
  readonly label?: string | (() => string)
}

/** The slot registry face a Client plugin uses. */
export interface SlotsLike {
  /** Wait for a slot declaration, then run the registration callback. */
  inject(slot: string, callback: () => Disposer | readonly Disposer[]): Disposer
  /** Register one contribution; returns its disposer. */
  register(options: SlotRegisterOptions, component: SlotComponent): Disposer
}

/** The Client locale service face this bundle uses. */
export interface ClientLocaleLike {
  /** Register one dictionary for one locale; returns a disposer. */
  register(namespace: string, locale: string, dict: Record<string, string>): Disposer
  /** Bind a namespace to a translate function reading the active locale. */
  bind(namespace: string): (key: string) => string
}

/** What a Remote call answers; the literal never rides a failure. */
export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error?: unknown }

/** Credential state as the wire reports it — configured, and writable from here. */
export interface CredentialInfoView {
  readonly configured?: boolean
  readonly writable?: boolean
}

/** The `remote.credentials` namespace: values are written, never read back. */
export interface CredentialsRemoteLike {
  /** Describe one or more references; returns no values, only their state. */
  describe(refs: string[]): Promise<RemoteResult<Record<string, CredentialInfoView>>>
  /** Store a value for one reference. */
  set(ref: string, value: string): Promise<unknown>
  /** Remove a stored value for one reference; the environment layer still answers. */
  unset(ref: string): Promise<unknown>
}

/** The `configForms` Client service: run while the Host serves a namespace. */
export interface ConfigFormsLike {
  /**
   * Run `callback` while the Host describes one of `namespaces`, and detach it
   * otherwise. Returns the detacher, or nothing on runtimes that inline it.
   */
  whileServed(namespaces: readonly string[], callback: () => Disposer): Disposer | void
}

/** The browser context face this bundle reads. */
export interface ClientContext {
  /** Slot registry (a hard dependency of this module). */
  readonly slots: SlotsLike
  /** Locale registry (a hard dependency of this module). */
  readonly locale: ClientLocaleLike
  /** Remote namespaces. */
  readonly remote: { readonly credentials: CredentialsRemoteLike }
  /** Settings-form service used to gate on the Host serving our entry. */
  readonly configForms: ConfigFormsLike
  /** Register a cleanup-aware effect on this plugin's fiber. */
  effect(body: () => unknown, label?: string): unknown
}

/** Props the Plugins page hands a configuration entry. */
export interface PluginConfigViewProps {
  /** `summary` is the one-liner; `page` is the form with its save control. */
  readonly view: 'summary' | 'page'
}
