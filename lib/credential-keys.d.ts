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
import type { Context } from '@deepseek-ai/cordis';
import type { KeySource } from './key-pool.js';
/** Construction options for {@link CredentialKeys}. */
export interface CredentialKeysOptions {
    /**
     * Keys spelled in configuration, read on every refresh so a committed
     * settings change reaches the next request; they win over every reference.
     */
    readonly configured?: (() => readonly string[]) | undefined;
    /** The plural credential reference, e.g. `TAVILY_API_KEYS`. */
    readonly ref: string;
    /** The singular credential reference, e.g. `TAVILY_API_KEY`. */
    readonly singularRef: string;
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
export declare function readVolatile<T>(value: unknown): T | undefined;
/**
 * One provider's credential list, resolvable from configuration, the
 * credentials domain, or the launch environment — in that order.
 */
export declare class CredentialKeys implements KeySource {
    private readonly ctx;
    private readonly options;
    /** The keys in force as of the last refresh. */
    private keys;
    /** Whether the first credentials read has not settled. */
    private warming;
    /** The in-flight credentials read, shared by concurrent refreshes. */
    private pending;
    /** Listeners notified whenever a refresh settles with the list now in force. */
    private readonly observers;
    /**
     * @param ctx - the plugin context.
     * @param options - the references to resolve and the configured keys.
     */
    constructor(ctx: Context, options: CredentialKeysOptions);
    /** The keys in force as of the last refresh. */
    current(): readonly string[];
    /** Whether the first credentials read has not settled yet. */
    isWarming(): boolean;
    /**
     * Re-read the credential plane. Concurrent callers share one read, a
     * configured list short-circuits it, and a composition without the
     * credentials service keeps the launch environment authoritative.
     * @returns the keys now in force.
     */
    refresh(): Promise<readonly string[]>;
    /**
     * Observe every settled refresh, so a pool built from the first list follows
     * later ones without polling. The listener is not primed with the current
     * list — {@link current} serves the initial build — and the returned
     * disposer detaches it.
     * @param listener - called with the list a refresh settled with.
     * @returns a disposer removing the listener.
     */
    observe(listener: (keys: readonly string[]) => void): () => void;
    /**
     * Watch what can change this list: the credential references this source
     * resolves (so a key written from the plugin's configuration page reaches
     * the pool without waiting for the next request) and the loader's volatile
     * config commit (so a key set through the configuration form does the same).
     * Both listeners are owned by the calling fiber; the returned disposer
     * detaches them early.
     * @returns a disposer removing the listeners.
     */
    watch(): () => void;
    /** Configured keys when the deployment spelled any, otherwise `undefined`. */
    private configured;
    /** Read one reference (plural first) through the credentials service. */
    private read;
    /** Hand the list now in force to every attached observer, contained per listener. */
    private publish;
}
