# Changelog

This file is maintained by Changesets. Entries below record product history that predates
the first publication; the package has not been released yet.

## 0.1.0 — 2026-09-28

First fleet release of `@skillre/dsh-plugin-tavily-firecrawl`: the native TypeScript port of the
standalone `dsh-tavily-firecrawl@0.2.0` package, brought under the fleet package, row and Cordis
plugin names (`skillre-tavily-firecrawl`, Cordis row `skillre-tavily-firecrawl`).

Carried over from `dsh-tavily-firecrawl@0.2.0` unchanged in behavior:

- **Multi-key rotation** on both sides: `apiKeys` / `TAVILY_API_KEYS` / `FIRECRAWL_API_KEYS`
  credential pools, round-robin selection, and per-key cooldowns
  (`rateLimitCooldownMs`, escalating `quotaCooldownMs` capped by `quotaCooldownMaxMs`).
- **Failure classification**: HTTP 401 is a dead credential for the rest of the process, 429 a
  short cooldown, 402/403/432/433 an escalating quota cooldown, 5xx a transient failure that
  rotates without blaming the key, and 400-class request errors stop rotation and surface as-is.
- **Error-message mapping**: Tavily's reason is read from `detail.error` (plus the older
  `detail` / `error` / `message` shapes) and Firecrawl's from its `success: false` envelopes,
  so a failure carries the API's own words and the pool's per-key state instead of a bare
  status code. A Firecrawl API-level error is no longer disguised as an empty successful page.
- `searchDepth` defaults to `basic` (1 credit instead of 2), `search.timeoutMs` bounds each
  attempt, and the Firecrawl body cap/`onlyMainContent` behavior is unchanged.

Fleet adaptations:

- Re-expressed as strict TypeScript (`src/key-pool.ts`, `src/search.ts`, `src/fetch.ts`,
  `src/index.ts`) with emitted declarations; the node:test suites became the vitest suites under
  `tests/`, preserving every case and assertion.
- The attribution `User-Agent` is now built from the packaged manifest at runtime
  (`skillre-tavily-firecrawl/<version> (tavily|firecrawl)`) instead of the frozen
  `deepseek-harness-*` literals, so it can never drift from the released version.
- `tools/live-smoke.mjs` moved to `scripts/live-smoke.mjs`; it stays a repository-only tool
  (excluded from `files`) and imports the built `lib/` output.
- The bundle patch keeps the source's wiring — pinning `web.searchProvider`/`fetchProvider` and
  disabling the shipped `web-search-deepseek` — under the fleet row id.

Audit fixes folded into this unreleased baseline (2026-10-03):

- **Unknown configuration keys are rejected.** Schemastery keeps keys it does not declare, so a
  typo such as `serach:` or `searchDepthh:` used to load, do nothing and leave the deployment on
  its defaults with no diagnostic; `apply` now refuses the row before registering anything.
- **An enabled side without a credential logs a warning at load** instead of surfacing only a
  generic tool-side `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` on the first call.
- **Short credentials are never half-revealed by their own mask**: the masked tail is shown only
  for keys longer than 20 characters, because a fixed `6…4` mask on an 11-character key exposed
  10 of its 11 characters.
- **Endpoint bases lose trailing slashes**, so `https://api.tavily.com/` posts to `/search`
  instead of `//search`; an unusable base is still rejected by `available()` rather than repaired.
- Documentation now states the install/uninstall ownership rules of the fleet policy, the
  `WEB_PROVIDER_UNAVAILABLE` end state of `searchEnabled: false`, the inertness of
  `DSH_WEB_SEARCH_PROVIDER`/`DSH_WEB_FETCH_PROVIDER` while the bundle pins those ids, and the
  difference between the Plugins manager's bundle toggle (removes the whole patch layer) and a
  hand-written per-row `disabled` in the user layer (breaks selection).

Removed legacy install paths (not restored):

- `install.sh` / `uninstall.sh` (symlink- and copy-based profile installs, forbidden by fleet
  policy; end users install, update and remove this package in the DSH Desktop Client or Web UI
  **Plugins** manager, and a developer packs a tarball only into an owned, disposable
  non-Desktop profile for verification);
- `tavily-firecrawl.patch.yml` and `enable-web-fetch-default.patch.yml` (duplicate/overlay patch
  forms; the shipped bundle patch is the only wiring);
- `presets/standard-web` (a fork of a shipped preset; DSH ≥ 0.1.5 presets already set
  `tool-web.fetch: true`, so a fork is pure drift risk; moreover nothing reads
  `$DSH_HOME/.agent-presets/` on current DSH — presets are bundle-declared `preset-<id>`
  rows now, so the legacy copy-directory install step is a no-op);
- the stale packaged `*.tgz`, the source `node_modules` snapshot and the pre-migration history.

Not yet published. `compatibility.json` records two passed mount verifications — DSH
`0.1.7-rc.2` (`2026-09-28`) and `0.2.0-rc.2` (`2026-09-30`; the 0.2.0 runtime initially
hard-rejected the old `<0.2.0` ranges, which were widened after re-inspection and a
re-run of the same gates) — and the version stays `0.1.0` until the first release.
