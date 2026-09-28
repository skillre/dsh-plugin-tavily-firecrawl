# @skillre/dsh-plugin-tavily-firecrawl

> 状态：experimental

Tavily search and Firecrawl fetch providers for the DeepSeek Harness web seam, with a rotating multi-key credential pool

把 DeepSeek Harness 的联网能力换成 **Tavily 搜索 + Firecrawl 抓取** 的组合，并支持**多 API Key 轮询**：一个纯 Host bundle，提供 `ctx.web` 的两个 provider，`dsh plugin add` 一条命令完成安装。

[English](README.en.md)

## 定位与非目标

本包向 `ctx.web`（`@deepseek-ai/dsh-web`）注册两个 provider：

- 搜索：Tavily（`POST https://api.tavily.com/search`）→ `web_search` 工具
- 抓取：Firecrawl（`POST https://api.firecrawl.dev/v1/scrape`，返回 markdown）→ `web_fetch` 工具

非目标：

- 不提供 UI、Slot、Client 端代码或设置面板；`package.json` 中没有 `dsh.client` 段。
- 不注册工具本身：`web_search` / `web_fetch` 这两个**工具**由 agent 预设里的 `tool-web`（`fetch: true`）决定，本包只提供 provider。
- 不 fork、不复制、不覆盖任何官方预设，也不写入 `$DSH_HOME/.agent-presets/`。
- 不修改 DSH 本体，不写文件系统（见「安全与权限」）。

## 安装

发布后（唯一受支持的安装路径）：

```sh
dsh plugin --profile <profile> add @skillre/dsh-plugin-tavily-firecrawl
```

本地开发内环（**必须走打包 tarball**）：

```sh
npm install
npm run check
npm pack
dsh plugin --profile <dev-profile> add ./skillre-dsh-plugin-tavily-firecrawl-0.1.0.tgz
dsh --profile <dev-profile> --dump-config
```

不要用 `dsh plugin ... add .`：把源码目录交给 pnpm 会建立源码链接安装，插件因此解析到**自己的** `node_modules` 而不是宿主的，本地一切正常、打包安装却在启动时炸掉整个 profile。`file:<tarball>` 才是受支持的形态，发布前还必须用 `npm pack` 的产物在隔离 profile 中重新挂载验证。

安装后填 Key 并重启 dsh（凭据在进程启动时读取一次）：

```sh
# 任选一层：进程环境、<调用目录>/.env、$DSH_HOME/.env
TAVILY_API_KEY=tvly-xxxx
FIRECRAWL_API_KEY=fc-xxxx
dsh web
```

更新：

```sh
dsh plugin --profile <profile> add @skillre/dsh-plugin-tavily-firecrawl@<version>
```

卸载与回滚见 [UNINSTALL.md](UNINSTALL.md)；本包不提供 `install.sh` / `uninstall.sh`，也不使用 `--patch` 叠加层。

## 开发原则

1. 加载 Cordis 插件开发技能。
2. 从当前 DSH Inspect Provider 查询准确 Service/Event/Builtin/Tool/Slot/Theme 契约。
3. 需要时先用创造模式完成动态原型。
4. 将验证后的行为提升为 TypeScript、配置 schema、测试和 Bundle composition。
5. 所有副作用必须在 stop/update 后清理。

本包使用的运行时契约（`ctx.web` 的 `registerSearchProvider` / `registerFetchProvider` 经 `ctx.effect` 绑定 Fiber、重复 id 抛 `WebError('…already registered', 'WEB_DUPLICATE_PROVIDER')`、选择规则、`WEB_PROVIDER_CONFIGURED_MISSING` / `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`、`search()` 按 `maxResults` 截断 `sources[]` 并置 `truncated`、非 2xx 页面是结果而非异常）均在 DSH `0.1.7-rc.2` 上通过 live Inspect 与随包源码核对，核对日期 `2026-09-28`。

## Bundle

- npm：`@skillre/dsh-plugin-tavily-firecrawl`
- GitHub：`skillre/dsh-plugin-tavily-firecrawl`
- Cordis row：`skillre-tavily-firecrawl`
- Cordis plugin name：`skillre-tavily-firecrawl`

`package.json#dsh.bundle.patch` 指向随包发布的 `cordis.patch.yml`，它做三件事：

1. 插入本插件行（id `skillre-tavily-firecrawl`），并把 `search.searchDepth` 显式设为 `basic`；
2. 把 `web` 行的 `searchProvider` / `fetchProvider` 分别钉到 `tavily` / `firecrawl`；
3. 禁用自带的 `web-search-deepseek`，避免两个搜索 provider 争抢选择。

`web-fetch-http` 仍保持注册（未禁用），只是 `fetchProvider` 已被钉住，所以不会被选中。

## 显示元数据

DSH 读取插件卡片信息时**不激活插件**，所以这些资源必须随包发布：

- `locale/en.json`（必需）与 `locale/<lang>.json`，内容形如 `{"meta": {"title": "...", "description": "..."}}`。
  它经 Node ESM resolver 解析，因此 `exports` 必须声明 `"./locale/*.json"`；缺这一条会抛
  `ERR_PACKAGE_PATH_NOT_EXPORTED`，而 DSH 会**静默吞掉**该错误，卡片退化成裸包名 —— 没有任何地方会报错。
- `icon`：顶层字段，指向包内相对路径的 SVG/PNG/JPEG/WebP，不超过 256 KiB，且 `files` 必须覆盖它。

本包实际发布的值：

- 卡片标题：`Tavily Search + Firecrawl Fetch`
- 卡片描述：`Tavily search and Firecrawl fetch providers for the DeepSeek Harness web seam, with a rotating multi-key credential pool`
- 图标：`icon.svg`（DSH 舰队默认图标）

`package.json#dsh.manifestVersion` 为 `1`。`engines.dsh` 声明本包真实挂载验证过的 DSH 行：range 只是文档，不是证据。

## 配置

在 patch 行的 `config:` 里覆盖（全部可选）：

```yaml
- insert:
    - id: skillre-tavily-firecrawl
      name: '@skillre/dsh-plugin-tavily-firecrawl'
      config:
        search:                      # Tavily 侧
          apiKeys: [tvly-aaaa, tvly-bbbb]   # 多 Key 轮询（推荐）
          apiKey: tvly-xxxx                 # 单 Key（旧写法，仍兼容）
          baseURL: https://api.tavily.com
          searchDepth: basic         # basic（1 credit）| advanced（2 credits）
          includeAnswer: true        # 让 Tavily 生成摘要（成为结果的 content）
          maxResults: 8              # 无 request.maxResults 时的默认条数
          timeoutMs: 30000           # 每次尝试的超时
          maxAttempts: 3             # 一次调用最多试几个 Key
          rateLimitCooldownMs: 60000 # 429 后的冷却
          quotaCooldownMs: 1800000   # 额度类错误的首次冷却
          quotaCooldownMaxMs: 86400000
        fetch:                       # Firecrawl 侧
          apiKeys: [fc-aaaa, fc-bbbb]
          apiKey: fc-xxxx
          baseURL: https://api.firecrawl.dev
          timeoutMs: 30000
          maxBodyChars: 200000       # 正文上限，超出截断并标记 truncated
          onlyMainContent: true
          maxAttempts: 3
          rateLimitCooldownMs: 60000
          quotaCooldownMs: 1800000
          quotaCooldownMaxMs: 86400000
        searchEnabled: true          # false 则不注册搜索 provider
        fetchEnabled: true           # false 则不注册抓取 provider
```

默认值（未配置时的实际行为）：

| 键 | 默认值 | 说明 |
|---|---|---|
| `search.baseURL` | `https://api.tavily.com` | 追加 `/search` |
| `search.searchDepth` | `basic` | Tavily 每次搜索 1 credit（`advanced` 2 credits） |
| `search.includeAnswer` | `true` | 生成摘要，成为结果的 `content` |
| `search.maxResults` | 未设置 | 只有 `web_search` 请求带 `maxResults` 时才限制 |
| `search.timeoutMs` | `30000` | 每次尝试 |
| `search.maxAttempts` | Key 数量 | 一次调用最多消耗几个 Key |
| `search.rateLimitCooldownMs` | `60000` | 429 冷却 |
| `search.quotaCooldownMs` | `1800000` | 额度类错误首次冷却（30 分钟） |
| `search.quotaCooldownMaxMs` | `86400000` | 指数退避上限（24 小时） |
| `fetch.baseURL` | `https://api.firecrawl.dev` | 追加 `/v1/scrape` |
| `fetch.timeoutMs` | `30000` | 每次尝试 |
| `fetch.maxBodyChars` | `200000` | 超出即截断并置 `truncated` |
| `fetch.onlyMainContent` | `true` | 只取正文 |
| `fetch.maxAttempts` / 冷却三项 | 同上 | 与搜索侧同义 |
| `searchEnabled` / `fetchEnabled` | `true` | 关掉即不注册该侧 provider |

Schema 会**大声失败**：类型不符、`searchDepth` 非 `basic`/`advanced`、`maxBodyChars: 0` 等都会在加载时抛错，而不是被静默忽略。

**凭据解析顺序**（每侧独立）：

1. `search.apiKeys` / `fetch.apiKeys`（配置，推荐，可多个）
2. `search.apiKey` / `fetch.apiKey`（配置，单 Key）
3. `TAVILY_API_KEYS` / `FIRECRAWL_API_KEYS`（环境，多 Key：逗号、分号、空白含换行都可分隔）
4. `TAVILY_API_KEY` / `FIRECRAWL_API_KEY`（环境，单 Key）

环境变量有三个层级，前者优先：进程启动环境 → `<调用目录>/.env` → `$DSH_HOME/.env`。

> ⚠️ 凭据在插件加载（进程启动）时读取一次，**改 Key / 改配置后必须重启 dsh**。

## 多 Key 轮询

免费版额度很小，注册多个账号后把 Key 列出来即可，插件会自动轮询：

```bash
TAVILY_API_KEYS=tvly-aaaa,tvly-bbbb,tvly-cccc
FIRECRAWL_API_KEYS=fc-aaaa;fc-bbbb
```

| 情况 | 行为 |
|---|---|
| 正常调用 | 在可用 Key 之间**轮流**使用（不是永远打第一个）；一次 `web_search` 里的多个并发查询会落在不同 Key 上 |
| HTTP 401（Key 失效） | 该 Key 本次进程内**永久剔除**，剩余 Key 继续 |
| HTTP 429（限流） | 该 Key 冷却 `rateLimitCooldownMs`（默认 60s），其余 Key 继续 |
| HTTP 402/403/432/433（额度/套餐） | 该 Key 冷却并从 `quotaCooldownMs`（默认 30 分钟）起**指数退避**，上限 `quotaCooldownMaxMs`（默认 24h） |
| HTTP 5xx | 换下一个 Key 重试，但不记该 Key 的问题 |
| HTTP 400 等请求级错误 | 与 Key 无关，直接报错，不再消耗其余 Key |
| 所有 Key 都不可用 | 明确报出每个 Key 的状态与预计恢复时间，而不是静默失败 |

冷却状态保存在内存里，**重启进程即清空**。

## 工具行为（模型可见）

- `web_search`：结果是 `{ content?, sources[], truncated }`。`content` 是 Tavily 的 `answer`（`includeAnswer: false` 时没有）；每个 source 是 `{ url, title?, snippet?, publishedAt? }`，`snippet` 由 Tavily 的 `content` 截断到 600 字符，无 URL 的条目被丢弃。`truncated` 由 seam 在按 `request.maxResults` 截断 `sources[]` 时置位（本 provider 自己恒为 `false`）。
- `web_fetch`：结果是 `{ url, statusCode, body, truncated }`。`body` 是 `{ kind: 'text', content }`，`content` 是 Firecrawl 的 markdown（超过 `maxBodyChars` 即截断并置 `truncated`）。被爬页面自身的非 2xx 状态**是结果而不是异常**（seam 契约），只有抓取 API 自身失败才抛 `WEB_PROVIDER_ERROR`。

## 兼容性

| DSH 版本 | 结果 | 验证日期 | 说明 |
|---|---|---|---|
| 0.1.7-rc.2 | 挂载验证通过 | 2026-09-28 | 由舰队集成方在隔离 profile 中执行 `--dump-config` + 有界真实启动 |

机器可读证据记录在 `compatibility.json`（当前 `verified: []`，待集成方写入真实记录后再发布）：

```json
{
  "dsh": "<exact-version>",
  "verifiedAt": "YYYY-MM-DD",
  "result": "passed",
  "checks": ["dump-config", "bounded-startup"]
}
```

Peer range 不是兼容性证据。写入证据后必须重新生成并挂载将要发布的最终 tarball，避免只验证了缺少证据文件的预备包。

## 安全与权限

- **网络出口**：仅出站 HTTPS 到 `api.tavily.com`（`POST /search`）与 `api.firecrawl.dev`（`POST /v1/scrape`）。请求使用 `redirect: 'error'`，重定向直接失败。没有其他网络访问。
- **凭据/机密**：`TAVILY_API_KEY(S)`、`FIRECRAWL_API_KEY(S)`，或配置里的 `apiKeys` / `apiKey`。密钥只放在 `Authorization: Bearer …` 与 Tavily 请求体的 `api_key` 字段里；错误消息、日志和工具输出只出现**脱敏标签**（如 `#2 (tvly-d…1111)`），不会打印可用密钥。
- **文件系统**：不写任何文件；只在启动时读一次随包发布的 `package.json` 作为 User-Agent 版本号（`skillre-tavily-firecrawl/<version> (tavily|firecrawl)`）。不读取凭据文件——launch environment 快照由 launcher 提供。
- **配置层风险**：写在插件 `config:` 里的 `apiKey`/`apiKeys` 会出现在 `dsh --dump-config` 输出中，**优先用环境变量**。
- **生命周期**：凭据与冷却状态都在插件加载时确定；所有 provider 注册都经 `ctx.web` 绑定当前 Fiber，stop/update 后移除（重新 `apply` 不会因重复 id 而失败，因为 seam 在 Fiber 销毁时注销 provider）。

## 卸载与回滚

见 [UNINSTALL.md](UNINSTALL.md)。

## 已知限制

- 冷却状态在内存中，重启 dsh 即清空（配额类错误也因此可能被提前重试）。
- Key 池为空时，`available()` 为 `false`，seam 只会给出通用的 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`；带每个 Key 状态与恢复时间的详细消息需要**至少一个 Key**。
- Firecrawl 侧只使用 seam 请求的 `url`，忽略其未来可能新增的其它选项（`web_fetch` 工具当前也只发送 `url`）。
- 搜索 snippet 一律截断到 600 字符。
- `searchEnabled: false` 时必须在用户自己的 profile 覆盖层里同时解开 `web.searchProvider` 的钉住，否则搜索会以 `WEB_PROVIDER_CONFIGURED_MISSING` 失败。
- 被爬页面的非 2xx 状态按 seam 契约作为**结果**返回，不会变成错误。
- 不支持 Windows 原生安装（建议 WSL）；Node 需满足 `engines.node`。

## 迁移与历史

本包是独立仓库 `dsh-tavily-firecrawl@0.2.0` 的**后继者**：行为等价地移植为原生 TypeScript，并纳入 DSH Plugin Fleet 的包名、行 id 与发布流程。下列旧安装路径**已移除**，且不会被恢复：

- `install.sh` / `uninstall.sh`（基于符号链接与文件复制的 profile 安装，舰队禁止）；
- `tavily-firecrawl.patch.yml`、`enable-web-fetch-default.patch.yml`（重复/叠加的 patch 形态）；
- `presets/standard-web`（官方预设的 fork；DSH ≥ 0.1.5 的自带预设已设 `tool-web.fetch: true`，fork 只会带来漂移风险）；
- 打包的旧 `*.tgz`。

## License

MIT
