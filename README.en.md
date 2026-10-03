# @skillre/dsh-plugin-tavily-firecrawl

> Status: experimental

Tavily search and Firecrawl fetch providers for the DeepSeek Harness web seam, with a rotating multi-key credential pool

Replaces the DeepSeek Harness web capabilities with **Tavily search + Firecrawl fetch**, with **multi-key rotation**: a Host-only bundle that provides two `ctx.web` providers; the user initiates final installation in the DSH Plugins manager.

[中文](README.md)

## Purpose and non-goals

The package registers two providers with `ctx.web` (`@deepseek-ai/dsh-web`):

- search: Tavily (`POST https://api.tavily.com/search`) → the `web_search` tool
- fetch: Firecrawl (`POST https://api.firecrawl.dev/v1/scrape`, markdown) → the `web_fetch` tool

Non-goals:

- no UI, Slot, Client code or settings panel; there is no `dsh.client` section in `package.json`;
- it does not register tools: `web_search` / `web_fetch` are gated by `tool-web` (`fetch: true`) in the agent preset, and this package only supplies providers;
- it does not fork, copy or override any shipped preset, and never writes to `$DSH_HOME/.agent-presets/`;
- it does not modify DSH itself and performs no filesystem writes (see "Security").

## Install

After compatibility verification and delivery, **you** select the source and initiate install/update/enablement in the DSH Desktop Client or Web UI **Plugins** manager; developers/agents do not preinstall into your profile. If published, compatible with your DSH version, and confirmed installable by the target manager, enter `@skillre/dsh-plugin-tavily-firecrawl@<version>`. An unpublished built package directory or `.tgz` needs an **absolute path**, manager support, and artifact verification. Offer a GitHub URL only where supported and after validating a safe, self-contained `prepare` build; a raw Git checkout is not an install-ready release.

Temporary developer-only loop (**owned, disposable non-Desktop profile; packed tarball only**):

```sh
npm install
npm run check
npm pack
dsh plugin --profile <dev-profile> add ./skillre-dsh-plugin-tavily-firecrawl-<version>.tgz
dsh --profile <dev-profile> --dump-config
# Also perform a bounded startup; clean up after the test or any failure.
```

Record the baseline and `finally`-style cleanup before installing. Stop test processes, remove only test-created bundle/dependency/selection/configuration state or the confirmed owned isolated profile, and verify absence even on failure. A test in the user's actual Desktop/Web profile requires prior consent and restoration of only test-created state, preserving existing installations and data; testing is not delivery. Do not use `dsh plugin ... add .`: pnpm can create a source link, resolving the plugin's **own** `node_modules` and hiding host API drift. The tarball path is for development testing; a `file:` dependency in a manifest is not a local install address entered by a user.

After installing, the user configures their own keys for the target runtime and restarts its DSH process (credentials are read once at startup). The following `dsh web` command is **only a standalone Web UI startup example**, not a Desktop Client installation command. Electron starts Desktop: verify its actual environment/credential configuration surface rather than assuming CLI environment or `.env` locations apply there:

```sh
# any of three layers: process environment, <invocation cwd>/.env, $DSH_HOME/.env
TAVILY_API_KEY=tvly-xxxx
FIRECRAWL_API_KEY=fc-xxxx
dsh web
```

Update: the user selects a verified compatible version in the same **Plugins** manager and confirms; an agent must not update the user's profile by CLI. Uninstall and rollback: see [UNINSTALL.md](UNINSTALL.md). This package ships no `install.sh` / `uninstall.sh` and uses no `--patch` overlays.

## Development contract

1. Load the Cordis plugin development skill.
2. Query exact current Service, Event, Builtin, Tool, Slot and Theme contracts through DSH Inspect Providers.
3. Build a dynamic creation-mode prototype when useful.
4. Promote verified behavior into TypeScript, configuration schemas, tests and Bundle composition.
5. Prove that every side effect is removed on stop or update.

Every runtime contract this package uses (`ctx.web` `registerSearchProvider` / `registerFetchProvider` bound to the current Fiber through `ctx.effect`; duplicate ids throwing `WebError('…already registered', 'WEB_DUPLICATE_PROVIDER')`; the selection rules; `WEB_PROVIDER_CONFIGURED_MISSING` / `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`; `search()` truncating `sources[]` to `maxResults` and setting `truncated`; a non-2xx fetched page being a result rather than a throw) was verified through live Inspect plus the shipped sources on DSH `0.1.7-rc.2` (`2026-09-28`) and again on `0.2.0-rc.2` (`2026-09-30`, after the app updated: identical `web` seam signatures and unchanged shipped composition rows).

## Bundle identity

- npm: `@skillre/dsh-plugin-tavily-firecrawl`
- GitHub: `skillre/dsh-plugin-tavily-firecrawl`
- Cordis row: `skillre-tavily-firecrawl`
- Cordis plugin name: `skillre-tavily-firecrawl`

`package.json#dsh.bundle.patch` points at the published `cordis.patch.yml`, which does three things:

1. inserts this plugin row (id `skillre-tavily-firecrawl`) and sets `search.searchDepth` explicitly to `basic`;
2. pins the `web` row's `searchProvider` / `fetchProvider` to `tavily` / `firecrawl`;
3. disables the shipped `web-search-deepseek` so two search providers never fight over selection.

`web-fetch-http` stays registered (not disabled); it is simply never selected because `fetchProvider` is pinned.

## Display metadata

DSH reads a plugin card **without activating the plugin**, so these resources must ship inside the package:

- `locale/en.json` (required) and `locale/<lang>.json`, shaped as `{"meta": {"title": "...", "description": "..."}}`.
  They are resolved through the Node ESM resolver, so `exports` must declare `"./locale/*.json"`; without that
  entry the resolver throws `ERR_PACKAGE_PATH_NOT_EXPORTED`, DSH **swallows the failure silently**, and the card
  degrades to the bare package name with no diagnostic anywhere.
- `icon`: a top-level field naming an in-package relative SVG/PNG/JPEG/WebP file of at most 256 KiB; `files` must cover it.

What this package actually ships:

- card title: `Tavily Search + Firecrawl Fetch`
- card description: `Tavily search and Firecrawl fetch providers for the DeepSeek Harness web seam, with a rotating multi-key credential pool`
- icon: `icon.svg` (the DSH fleet default icon; replace it with this plugin's own mark before release)
- shipped locales: **`locale/en.json` only**, so the card's title and description are English-only (this README has a Chinese twin; the card text does not)

`package.json#dsh.manifestVersion` is `1`. `engines.dsh` states the DSH lines this package was really mounted and tested against: a range is documentation, not evidence — the only exact versions mounted and recorded in `compatibility.json` are `0.1.7-rc.2` (2026-09-28) and `0.2.0-rc.2` (2026-09-30).

## Configuration

Override any of these in the patch row's `config:` (all optional). **The numbers below are examples, not defaults** — the defaults are in the table that follows, and any key you omit keeps them.

```yaml
- insert:
    - id: skillre-tavily-firecrawl
      name: '@skillre/dsh-plugin-tavily-firecrawl'
      config:
        search:                      # Tavily side
          apiKeys: [tvly-aaaa, tvly-bbbb]   # multi-key rotation (preferred)
          apiKey: tvly-xxxx                 # single key (legacy form, still supported)
          baseURL: https://api.tavily.com
          searchDepth: basic         # basic (1 credit) | advanced (2 credits)
          includeAnswer: true        # ask Tavily for a synthesized answer (becomes `content`)
          maxResults: 8              # default result count when a request carries none
          timeoutMs: 30000           # per-attempt timeout
          maxAttempts: 3             # how many keys one call may try
          rateLimitCooldownMs: 60000 # cooldown after HTTP 429
          quotaCooldownMs: 1800000   # first cooldown after a plan/quota refusal
          quotaCooldownMaxMs: 86400000
        fetch:                       # Firecrawl side
          apiKeys: [fc-aaaa, fc-bbbb]
          apiKey: fc-xxxx
          baseURL: https://api.firecrawl.dev
          timeoutMs: 30000
          maxBodyChars: 200000       # body cap; over-long bodies are truncated and flagged
          onlyMainContent: true
          maxAttempts: 3
          rateLimitCooldownMs: 60000
          quotaCooldownMs: 1800000
          quotaCooldownMaxMs: 86400000
        searchEnabled: true          # false = do not register the search provider
        fetchEnabled: true           # false = do not register the fetch provider
```

Defaults (what actually happens when a key is absent):

| Key | Default | Notes |
|---|---|---|
| `search.baseURL` | `https://api.tavily.com` | `/search` is appended |
| `search.searchDepth` | `basic` | Tavily bills 1 credit per search (`advanced` costs 2) |
| `search.includeAnswer` | `true` | answer becomes the result's `content` |
| `search.maxResults` | unset | only a `web_search` request's own `maxResults` bounds results; when neither is set no `max_results` is sent and Tavily's server-side default applies |
| `search.timeoutMs` | `30000` | per attempt |
| `search.maxAttempts` | pool size | how many keys one call may burn |
| `search.rateLimitCooldownMs` | `60000` | HTTP 429 cooldown |
| `search.quotaCooldownMs` | `1800000` | first quota cooldown (30 minutes) |
| `search.quotaCooldownMaxMs` | `86400000` | escalating cooldown ceiling (24 hours) |
| `fetch.baseURL` | `https://api.firecrawl.dev` | `/v1/scrape` is appended |
| `fetch.timeoutMs` | `30000` | per attempt |
| `fetch.maxBodyChars` | `200000` | beyond this the body is truncated and `truncated` is set |
| `fetch.onlyMainContent` | `true` | extract only the page's main content |
| `fetch.maxAttempts` / the three cooldowns | same as above | same semantics as the search side |
| `searchEnabled` / `fetchEnabled` | `true` | false = do not register that side |

The schema **fails loudly**: wrong types, a `searchDepth` other than `basic`/`advanced`, or `maxBodyChars: 0` all throw at load time instead of being silently ignored.

**Unknown keys are rejected too.** Schemastery's object schema keeps keys it does not declare, so a typo would otherwise slip past validation. `apply` lists every key the schema does not declare (root, `search.*`, `fetch.*`) and throws — `serach:`, `searchDepthh:`, `fetch.maxBodyChar` — and the row does not mount at all. The accepted key sets are derived from the same field tables the schema is built from, so they cannot drift apart.

**Credential resolution order** (each side independently):

1. `search.apiKeys` / `fetch.apiKeys` (config, preferred, may be a list)
2. `search.apiKey` / `fetch.apiKey` (config, single)
3. `TAVILY_API_KEYS` / `FIRECRAWL_API_KEYS` (environment; comma, semicolon and whitespace including newlines all separate keys)
4. `TAVILY_API_KEY` / `FIRECRAWL_API_KEY` (environment, single)

The environment has three layers, most trusted first: the inherited process environment → `<invocation cwd>/.env` → `$DSH_HOME/.env`.

> ⚠️ Credentials are read once when the plugin loads (process start). **Restart dsh after changing keys or config.**

## Multi-key rotation

Free plans are small: register several accounts and list the keys, and the plugin rotates automatically.

```bash
TAVILY_API_KEYS=tvly-aaaa,tvly-bbbb,tvly-cccc
FIRECRAWL_API_KEYS=fc-aaaa;fc-bbbb
```

| Situation | Behavior |
|---|---|
| Normal call | keys are used **round-robin** (not always the first); parallel queries inside one `web_search` land on different keys |
| HTTP 401 (dead key) | that key is **dropped for the rest of the process**, remaining keys continue |
| HTTP 429 (throttle) | that key cools down for `rateLimitCooldownMs` (default 60s), others continue |
| HTTP 402/403/432/433 (plan/quota) | that key cools down and **escalates** from `quotaCooldownMs` (default 30 min) up to `quotaCooldownMaxMs` (default 24h) |
| HTTP 5xx | retry on the next key without blaming the current one |
| HTTP 400 and other request-level errors | key-neutral: fail immediately, do not burn the remaining keys |
| Every key unusable | the error names each key's state and the estimated recovery time instead of failing silently |

Cooldowns live in memory and are **cleared by a restart**.

## Tool behaviour (model-visible)

- `web_search` resolves to `{ content?, sources[], truncated }`. `content` is Tavily's `answer` (absent when `includeAnswer: false`); each source is `{ url, title?, snippet?, publishedAt? }` where `snippet` is Tavily's `content` truncated to 600 characters and entries without a URL are dropped. `truncated` is set by the seam when it cuts `sources[]` to the request's `maxResults` (this provider itself always reports `false`).
- `web_fetch` resolves to `{ url, statusCode, body, truncated }`. `body` is `{ kind: 'text', content }` carrying Firecrawl's markdown (truncated past `maxBodyChars`, with `truncated` set). A non-2xx status of the **scraped page** is a result, not an exception (the seam's contract); only the scrape API's own failure raises `WEB_PROVIDER_ERROR`.

## Compatibility

| DSH version | Result | Verified | Notes |
|---|---|---|---|
| 0.1.7-rc.2 | Mount verification passed | 2026-09-28 | Isolated-profile `--dump-config` plus a bounded real startup, performed by the fleet integrator |
| 0.2.0-rc.2 | Mount verification passed | 2026-09-30 | Re-verification after the app moved to the new line: 0.2.0 first **hard-rejected** the old `<0.2.0` ranges (experiment archived), then `engines.dsh` and the peer ranges were widened per the DSH-upgrade procedure after re-inspection, and the final tarball passed the same gates |

Machine-readable evidence lives in `compatibility.json` (two `passed` records: `0.1.7-rc.2` / `2026-09-28` and `0.2.0-rc.2` / `2026-09-30`, checks covering `dump-config`, `bounded-startup`, `display-metadata`; the block below only shows the shape of each record):

```json
{
  "dsh": "<exact-version>",
  "verifiedAt": "YYYY-MM-DD",
  "result": "passed",
  "checks": ["dump-config", "bounded-startup"]
}
```

A peer range is not compatibility evidence. After recording evidence, rebuild and mount the exact final tarball so the tested artifact also contains that evidence.

## Security

- **Network egress**: outbound HTTPS only, to `api.tavily.com` (`POST /search`) and `api.firecrawl.dev` (`POST /v1/scrape`). Requests use `redirect: 'error'`, so redirects fail instead of being followed. No other network access.
- **Secrets**: `TAVILY_API_KEY(S)`, `FIRECRAWL_API_KEY(S)`, or `apiKeys` / `apiKey` in config. Keys appear only in the `Authorization: Bearer …` header and Tavily's `api_key` body field; error messages, logs and tool output carry **masked labels** (e.g. `#2 (tvly-d…1111)`) and never a usable secret. The masked tail is shown only for keys longer than 20 characters; shorter ones are named by position alone (`#2`), so a fixed-length mask cannot print most of a short secret.
- **Filesystem**: nothing is written. The only read is the packaged `package.json`, read once at load to build the User-Agent (`skillre-tavily-firecrawl/<version> (tavily|firecrawl)`). Credential files are not read directly — the launch environment snapshot is supplied by the launcher.
- **Logging**: when a side is enabled without any credential, `ctx.logger.warn` emits one message naming the configuration keys but no secret (e.g. `tavily search registered without an API key: …`), so a missing configuration surfaces before the first tool call. There is no other runtime logging.
- **Config-layer risk**: `apiKey`/`apiKeys` written into the plugin's `config:` appear in `dsh --dump-config` output, so **environment variables are preferred**.
- **Lifecycle**: credentials and cooldowns are fixed at load time, and every provider registration is bound to the current Fiber through `ctx.web`, so it is removed on stop/update (a later `apply` cannot hit a duplicate-id error, because the seam unregisters providers when the Fiber is disposed).

## Uninstall and rollback

See [UNINSTALL.md](UNINSTALL.md).

## Known limitations

- Cooldowns are in memory and reset on restart (so a quota refusal can be retried earlier than intended).
- With an empty key pool `available()` is `false` and the seam reports only its generic `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`; the rich per-key state and recovery estimate need **at least one key**. A `ctx.logger.warn` is emitted at load naming the unkeyed side.
- The Firecrawl side uses only the seam request's `url` and ignores any other option a future seam revision might add (`web_fetch` currently sends `url` only).
- Search snippets are always capped at 600 characters.
- With `searchEnabled: false` you must do **both** of these in your own profile override: unpin `web.searchProvider`, and re-enable `web-search-deepseek` (`disabled: false`) or pin another installed search provider. Unpinning alone is not enough: this bundle has already disabled the shipped search provider, so after unpinning there is no usable search provider at all and the seam fails with `WEB_PROVIDER_UNAVAILABLE` rather than `WEB_PROVIDER_CONFIGURED_MISSING`.
- **vs. the built-in "Web search / DeepSeek search provider" settings card**: that card edits the `web-search-deepseek` namespace (`apiKeyEnv` / `apiKey` / `baseURL` / `maxUses`) and takes **no part in provider selection** — selection is decided solely by the `web` row's `searchProvider`. Because this bundle disables the `web-search-deepseek` row, its Fiber never starts, its settings section is never installed, and the card **disappears from Settings → Plugins** (it is not greyed out; it is not registered). If you re-enable that row yourself, the card comes back and its values save, but while `web.searchProvider` stays pinned to `tavily` those values are **never used and never reported** — unpin as well to make them take effect.
- **The official env escape hatch is inert while pinned**: the seam constructs `config.searchProvider ?? process.env.DSH_WEB_SEARCH_PROVIDER`, so once this bundle writes the config, `DSH_WEB_SEARCH_PROVIDER` / `DSH_WEB_FETCH_PROVIDER` are no longer read. To switch back to a built-in provider, override `web.searchProvider` in your profile layer (the user layer outranks the bundle layer).
- **How you disable this plugin matters**: the Plugins manager marks bundle-provided rows `unaddressable` (read-only), so the control it offers is the **whole-bundle toggle**, which removes the entire patch layer — the pin and the `web-search-deepseek` disable go away with it and the built-in search comes back. That is the clean path. **Do not** hand-write `- id: skillre-tavily-firecrawl / disabled: true` in your `cordis.patch.yml`: that stops this row only, while the bundle layer's `web` pin and the `web-search-deepseek` disable still apply, leaving `web_search`/`web_fetch` failing with `WEB_PROVIDER_CONFIGURED_MISSING` and the built-in search still switched off. To remove the plugin, remove the whole bundle (see [UNINSTALL.md](UNINSTALL.md)).
- A non-2xx status of the scraped page is returned as a **result**, per the seam's contract.
- The patch's `web` / `web-search-deepseek` targets ship in `@deepseek-ai/dsh-base`; on a hand-built profile without those rows the loader warns and skips those entries (the pins silently do not apply) while this row still waits on `inject: ['web']`.
- No native Windows install is supported (use WSL); Node must satisfy `engines.node`.

## Migration and lineage

This package is the successor of the standalone `dsh-tavily-firecrawl@0.2.0` repository: the same behavior, re-expressed as native TypeScript and brought under DSH Plugin Fleet package, row and release conventions. The following legacy install paths are **removed** and will not come back:

- `install.sh` / `uninstall.sh` (symlink- and copy-based profile installs, forbidden by fleet policy);
- `tavily-firecrawl.patch.yml`, `enable-web-fetch-default.patch.yml` (duplicate/overlay patch forms);
- `presets/standard-web` (a fork of a shipped preset; DSH ≥ 0.1.5 already sets `tool-web.fetch: true`, so a fork is pure drift risk; also, nothing reads `$DSH_HOME/.agent-presets/` any more — a modern preset is a bundle-declared `preset-<id>` row, so the legacy install script's "copy the directory" step is a no-op on current DSH);
- the stale packaged `*.tgz`.

**Migration order**: the user first checks backups and dependencies, then removes their old `dsh-tavily-firecrawl` package in the Desktop Client/Web UI **Plugins** manager; next, in that manager, choose and install a verified compatible `@skillre/dsh-plugin-tavily-firecrawl@<version>` and check provider status. Both register `ctx.web` ids `tavily` / `firecrawl`; a concurrent second `apply` fails with `WEB_DUPLICATE_PROVIDER`. Developers/agents must not remove the user's existing plugin or install its replacement for them; CLI is for separately authorized recovery only if the manager cannot start.

## License

MIT
