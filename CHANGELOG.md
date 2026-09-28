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

Removed legacy install paths (not restored):

- `install.sh` / `uninstall.sh` (symlink- and copy-based profile installs, forbidden by fleet
  policy; use `dsh plugin --profile <profile> add|remove` with a packed tarball instead);
- `tavily-firecrawl.patch.yml` and `enable-web-fetch-default.patch.yml` (duplicate/overlay patch
  forms; the shipped bundle patch is the only wiring);
- `presets/standard-web` (a fork of a shipped preset; DSH ≥ 0.1.5 presets already set
  `tool-web.fetch: true`, so a fork is pure drift risk);
- the stale packaged `*.tgz`, the source `node_modules` snapshot and the pre-migration history.

Not yet published. `compatibility.json` records the passed DSH `0.1.7-rc.2` mount verification
(`2026-09-28`, checks: `dump-config`, `bounded-startup`, `display-metadata`), and the version
stays `0.1.0` until the first release.
