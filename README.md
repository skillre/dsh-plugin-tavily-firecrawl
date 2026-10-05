# @skillre/dsh-plugin-tavily-firecrawl

> 状态：experimental

Tavily search and Firecrawl fetch providers for the DeepSeek Harness web seam, with a rotating multi-key credential pool

把 DeepSeek Harness 的联网能力换成 **Tavily 搜索 + Firecrawl 抓取** 的组合，并支持**多 API Key 轮询**：一个 bundle（Host 侧两个 `ctx.web` provider + 一张浏览器配置页），Key 可以直接在 设置 → 插件 里填写；最终安装由用户在 DSH 插件管理界面发起。

[English](README.en.md)

## 定位与非目标

本包向 `ctx.web`（`@deepseek-ai/dsh-web`）注册两个 provider：

- 搜索：Tavily（`POST https://api.tavily.com/search`）→ `web_search` 工具
- 抓取：Firecrawl（`POST https://api.firecrawl.dev/v1/scrape`，返回 markdown）→ `web_fetch` 工具

浏览器侧只有一个面：**设置 → 插件 → 本 bundle 页面**上的配置页（`package.json#dsh.client`，`platform: web`，只注册 `plugins.bundle.config` 一个槽），用来填写/清除 API Key。

非目标：

- 不提供聊天内装饰、会话级 UI 或布局 Slot 占位；除上面那张配置页外没有任何浏览器代码。
- 不注册工具本身：`web_search` / `web_fetch` 这两个**工具**由 agent 预设里的 `tool-web`（`fetch: true`）决定，本包只提供 provider。
- 不 fork、不复制、不覆盖任何官方预设，也不写入 `$DSH_HOME/.agent-presets/`。
- 不修改 DSH 本体，不直接写文件系统（凭据存储由 DSH 的凭据服务写入，见「安全与权限」）。

## 安装

完成兼容性验证并交付后，**用户**在 DSH Desktop Client 或 Web UI 的 **Plugins/插件管理**中自行选择来源、安装/更新及启用；开发者/agent 不在用户 profile 代装。发布且目标版本兼容、管理器确认可安装时，可输入 npm 包名 `@skillre/dsh-plugin-tavily-firecrawl@<version>`。未发布时，可提供已构建、验证可用的本地包目录或 `.tgz` **绝对路径**，须先确认目标管理器支持。GitHub URL 只有在管理器支持、仓库含安全且自包含的 `prepare` 构建并通过安装验证后才能列为来源；原始 Git 源码不是自动可用的成品。

仅供开发者临时测试的内环（**自有、可丢弃的非 Desktop profile，必须走打包 tarball**）：

```sh
npm install
npm run check
npm pack
dsh plugin --profile <dev-profile> add ./skillre-dsh-plugin-tavily-firecrawl-<version>.tgz
dsh --profile <dev-profile> --dump-config
# 另行进行有界真实启动；测试结束或失败时须执行下述清理。
```

安装前登记基线与 `finally` 式清理；测试结束（包括失败）停止进程，仅卸载本次安装的 bundle/依赖/选择/配置或清理确认归属的隔离 profile，并核验无残留。用户真实 Desktop/Web profile 的测试须事先同意并仅撤销测试新增状态，不触碰已有安装和数据；测试不是交付。不要用 `dsh plugin ... add .`：源码目录交给 pnpm 会建立源码链接，让插件解析到**自己的** `node_modules`，掩盖宿主 API 漂移。打包 tarball 仅是开发验证路径；清单中的 `file:` 依赖不是用户在界面输入的本地包地址。

**装好之后填 Key（推荐方式）**：在 DSH 的 **设置 → 插件** 里打开本 bundle 的页面，配置页上有 Tavily / Firecrawl 两个输入框——直接粘贴一个或多个 Key（逗号、分号或换行分隔），点「保存」即可。Key 写进 DSH 的**凭据存储**（不进 profile 配置、不出现在 `dsh --dump-config`），**下一次搜索/抓取立即生效，无需重启**；「清除已保存的密钥」只删存储值，环境变量里若有仍会继续生效。

也可以用环境变量（进程启动时读取一次，改完需重启对应 DSH 进程）。下列 `dsh web` 仅是**独立 Web UI 的启动示例**，不是 Desktop Client 插件安装命令；Desktop 由 Electron 启动，须先核实其实际环境变量/凭据入口，不要把 CLI 命令或 `.env` 位置直接当成 Desktop 的配置指引：

```sh
# 任选一层：进程环境、<调用目录>/.env、$DSH_HOME/.env
TAVILY_API_KEY=tvly-xxxx
FIRECRAWL_API_KEY=fc-xxxx
dsh web
```

更新：由用户在同一 **Plugins/插件管理**中选择经验证兼容的新版本并确认；不要由 agent 在用户 profile 执行 CLI 安装。卸载与回滚见 [UNINSTALL.md](UNINSTALL.md)；本包不提供 `install.sh` / `uninstall.sh`，也不使用 `--patch` 叠加层。

## 开发原则

1. 加载 Cordis 插件开发技能。
2. 从当前 DSH Inspect Provider 查询准确 Service/Event/Builtin/Tool/Slot/Theme 契约。
3. 需要时先用创造模式完成动态原型。
4. 将验证后的行为提升为 TypeScript、配置 schema、测试和 Bundle composition。
5. 所有副作用必须在 stop/update 后清理。

本包使用的运行时契约（`ctx.web` 的 `registerSearchProvider` / `registerFetchProvider` 经 `ctx.effect` 绑定 Fiber、重复 id 抛 `WebError('…already registered', 'WEB_DUPLICATE_PROVIDER')`、选择规则、`WEB_PROVIDER_CONFIGURED_MISSING` / `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`、`search()` 按 `maxResults` 截断 `sources[]` 并置 `truncated`、非 2xx 页面是结果而非异常）均通过 live Inspect 与随包源码核对：DSH `0.1.7-rc.2`（`2026-09-28`）与 `0.2.0-rc.2`（`2026-09-30` 应用更新后复检，`web` seam 签名逐字一致、随包组成行未变）。

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
- 图标：`icon.svg`（DSH 舰队默认图标，发布前应换成本插件自己的图标）
- 随包 locale：**仅 `locale/en.json`**，因此插件卡片的标题/描述目前只有英文（本 README 有中文版，卡片文案没有）

`package.json#dsh.manifestVersion` 为 `1`。`engines.dsh` 声明本包真实挂载验证过的 DSH 行：range 只是文档，不是证据，实际挂载并记录在 `compatibility.json` 的只有 `0.1.7-rc.2`（2026-09-28）与 `0.2.0-rc.2`（2026-09-30）两个确切版本。

## 配置

在 patch 行的 `config:` 里覆盖（全部可选）。**下面的数值是示例，不是默认值** —— 默认值见紧随其后的表格；没写到的键一律沿用默认值。

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
| `search.maxResults` | 未设置 | 只有 `web_search` 请求带 `maxResults` 时才限制；不设置就不发 `max_results`，由 Tavily 服务端默认条数兜底 |
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

**未知键同样会被拒绝**：Schemastery 的 object schema 会原样保留它不认识的键，因此光靠 schema 挡不住拼写错误。`apply` 会把 schema 未声明的键（根级、`search.*`、`fetch.*`）列出来并抛错，例如 `serach:`、`searchDepthh:`、`fetch.maxBodyChar`，整行不会挂载 —— 允许的键集合与 schema 由同一份字段表生成，不会漂移。

**凭据解析顺序**（每侧独立）：

1. `search.apiKeys` / `fetch.apiKeys`（插件行 `config`，显式最高，可多个）
2. `search.apiKey` / `fetch.apiKey`（插件行 `config`，单 Key）
3. 凭据引用 **`TAVILY_API_KEYS` / `FIRECRAWL_API_KEYS`** —— **配置页保存的就是它**；同一引用内部再分层：继承环境 → 凭据存储 → `<调用目录>/.env` → `$DSH_HOME/.env`
4. 单 Key 引用 `TAVILY_API_KEY` / `FIRECRAWL_API_KEY`（同样的分层）

多 Key 的值用逗号、分号或空白（含换行）分隔；配置页保存时会规范成一行逗号分隔的列表。

> ✅ **配置页保存后无需重启**：请求开始前会重新解析引用，并监听 `credentials/reference-updated`，所以保存完成即进入轮池。
> ⚠️ 仍需重启的两类改动：改**环境变量**（进程启动时的 launch 快照）；改插件行 `config` 里的**其它**字段（如 `searchDepth`、`maxBodyChars`）——它们不参与上面的实时读取，由 Loader 的常规配置更新流程处理，若未即时生效就重启 DSH。

## 多 Key 轮询

免费版额度很小，注册多个账号后把 Key 列出来即可，插件会自动轮询。两种等价写法：

- **配置页（推荐）**：设置 → 插件 → 本 bundle 页面，在输入框里粘贴 `tvly-aaaa, tvly-bbbb, tvly-cccc` 后保存；
- **环境变量**：

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
| 运行中增删 Key | 每次请求前重新解析凭据引用并合并进轮池：**留下的 Key 保留冷却状态**，新 Key 干净加入，被删的 Key 随状态一起消失（无需重启） |

冷却状态保存在内存里，**重启进程即清空**。

## 工具行为（模型可见）

- `web_search`：结果是 `{ content?, sources[], truncated }`。`content` 是 Tavily 的 `answer`（`includeAnswer: false` 时没有）；每个 source 是 `{ url, title?, snippet?, publishedAt? }`，`snippet` 由 Tavily 的 `content` 截断到 600 字符，无 URL 的条目被丢弃。`truncated` 由 seam 在按 `request.maxResults` 截断 `sources[]` 时置位（本 provider 自己恒为 `false`）。
- `web_fetch`：结果是 `{ url, statusCode, body, truncated }`。`body` 是 `{ kind: 'text', content }`，`content` 是 Firecrawl 的 markdown（超过 `maxBodyChars` 即截断并置 `truncated`）。被爬页面自身的非 2xx 状态**是结果而不是异常**（seam 契约），只有抓取 API 自身失败才抛 `WEB_PROVIDER_ERROR`。

## 兼容性

| DSH 版本 | 结果 | 验证日期 | 说明 |
|---|---|---|---|
| 0.1.7-rc.2 | 挂载验证通过 | 2026-09-28 | 由舰队集成方在隔离 profile 中执行 `--dump-config` + 有界真实启动 |
| 0.2.0-rc.2 | 挂载验证通过 | 2026-09-30 | 应用更新到新线后的复验：0.2.0 运行时先**硬拒绝**了旧的 `<0.2.0` 范围（实验证据已存档），按「DSH 升级」流程重新 Inspect 后扩展 `engines.dsh` 与 peer 范围，再以最终 tarball 通过同一套门禁 |

机器可读证据记录在 `compatibility.json`（两条 `passed` 记录：`0.1.7-rc.2` / `2026-09-28` 与 `0.2.0-rc.2` / `2026-09-30`，checks 含 `dump-config`、`bounded-startup`、`display-metadata`；下面只是每条记录的形状）：

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
- **凭据/机密**：`TAVILY_API_KEY(S)`、`FIRECRAWL_API_KEY(S)`，或插件行 `config` 里的 `apiKeys` / `apiKey`。密钥只放在 `Authorization: Bearer …` 与 Tavily 请求体的 `api_key` 字段里；错误消息、日志和工具输出只出现**脱敏标签**（如 `#2 (tvly-d…1111)`），不会打印可用密钥。脱敏标签只对长度 > 20 位的 Key 显示首 6 + 末 4 位，更短的 Key 只显示序号（`#2`），避免固定长度的掩码反而把短密钥几乎完整地印出来。
- **配置页保存的 Key 存在哪里**：由 DSH 的**凭据服务**写入凭据存储（`remote.credentials.set`），本包自己不落盘——不进 profile 配置、不出现在 `dsh --dump-config`、也不会随 settings 响应回传；schema 里这两个字段标了 `role('secret')`，配置面即使列出它们也只回传 `set: true`。凭据服务与 Remote 都不回传明文，配置页只显示「已保存 / 未保存」。
- **文件系统**：本包代码不写任何文件；只在启动时读一次随包发布的 `package.json` 作为 User-Agent 版本号（`skillre-tavily-firecrawl/<version> (tavily|firecrawl)`）。凭据存储的落盘由 DSH 凭据服务完成，不读取凭据文件——launch environment 快照由 launcher 提供。
- **日志**：首次凭据解析完成后，若某侧一个 Key 都没有，会经 `ctx.logger.warn` 打一条不含密钥、只含配置键名的提示（例如 `tavily search registered without an API key: …`），用于在第一次工具调用失败之前暴露缺配置；除此之外无任何运行期日志输出。
- **配置层风险**：写在插件行 `config:` 里的 `apiKey`/`apiKeys` 会出现在 `dsh --dump-config` 输出中，**优先用配置页或环境变量**。
- **生命周期**：provider 注册与配置页注册都经 `ctx.effect` 绑定当前 Fiber，stop/update 后移除（重新 `apply` 不会因重复 id 而失败，因为 seam 在 Fiber 销毁时注销 provider）；凭据引用在每次请求前解析，冷却状态在内存中按 Key 保留。

## 卸载与回滚

见 [UNINSTALL.md](UNINSTALL.md)。

## 已知限制

- 冷却状态在内存中，重启 dsh 即清空（配额类错误也因此可能被提前重试）。
- Key 池为空时，seam 只会给出通用的 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`；带每个 Key 状态与恢复时间的详细消息需要**至少一个 Key**。首次凭据解析完成后若仍无 Key，会打一条 `ctx.logger.warn` 提示该侧没有凭据。
- **配置页依赖 DSH 的凭据服务与 `plugins.bundle.config` 槽**：两者在 `0.1.7-rc.2` / `0.2.0-rc.2` 都存在；如果某个组合缺失，配置页不会注册（浏览器半也不加载），此时仍可用环境变量或插件行 `config` 供 Key。
- **配置页只能保存/清除，不显示已存 Key 的内容**：凭据服务与 Remote 都不回传明文，页面只显示「已保存 / 未保存 / 由环境提供」。
- **清除了仍可能有 Key**：清除只删凭据存储里的值；若同一引用在环境或 `.env` 里还有值，下一次请求仍会解析到它。
- Firecrawl 侧只使用 seam 请求的 `url`，忽略其未来可能新增的其它选项（`web_fetch` 工具当前也只发送 `url`）。
- 搜索 snippet 一律截断到 600 字符。
- `searchEnabled: false` 时要在用户自己的 profile 覆盖层里**同时做两件事**：解开 `web.searchProvider` 的钉住，并把 `web-search-deepseek` 重新 `disabled: false`（或钉住另一个已装的搜索 provider）。只解开钉住是不够的：本 bundle 已经禁用了自带的搜索 provider，解开后没有任何可用搜索 provider，seam 会以 `WEB_PROVIDER_UNAVAILABLE`（而不是 `WEB_PROVIDER_CONFIGURED_MISSING`）失败。
- **与 DSH 自带「网页搜索 / DeepSeek 搜索提供方」设置卡的关系**：该卡片编辑的是 `web-search-deepseek` 命名空间（`apiKeyEnv` / `apiKey` / `baseURL` / `maxUses`），**不参与 provider 选择**；选择只由 `web` 行的 `searchProvider` 决定。本 bundle 禁用了 `web-search-deepseek` 行，该插件的 Fiber 不启动，其 settings section 也随之注销，所以**这张卡片会从 设置 → 插件 中消失**（不是失效，是不注册）。如果用户之后自行重新启用该行，卡片会回来、配置也能保存，但因为 `web.searchProvider` 仍被钉在 `tavily`，那些配置**不会被使用也不会报错** —— 需要同时解开钉住才生效。
- **官方环境变量逃生口在钉住期间无效**：seam 的构造是 `config.searchProvider ?? process.env.DSH_WEB_SEARCH_PROVIDER`，本 bundle 一旦写入 config，`DSH_WEB_SEARCH_PROVIDER` / `DSH_WEB_FETCH_PROVIDER` 就不再被读取。要切换回内置 provider，请改 profile 覆盖层里的 `web.searchProvider`（用户层优先级高于 bundle 层）。
- **禁用本插件的方式很关键**：Plugins 管理器对 bundle 提供的行只暴露 `unaddressable`（只读），可用的开关是**整包开关**，它移除整个 patch 层 —— 钉住与 `web-search-deepseek` 的禁用会一起消失，自带搜索随即恢复，这是干净的路径。**不要**在用户 `cordis.patch.yml` 里手写 `- id: skillre-tavily-firecrawl / disabled: true`：那只会停掉本行，bundle 层的 `web` 钉住与 `web-search-deepseek` 禁用仍然生效，结果是 `web_search`/`web_fetch` 以 `WEB_PROVIDER_CONFIGURED_MISSING` 失败、内置搜索也仍被禁用。卸载请直接移除整个 bundle（见 [UNINSTALL.md](UNINSTALL.md)）。
- 被爬页面的非 2xx 状态按 seam 契约作为**结果**返回，不会变成错误。
- bundle patch 里的 `web` / `web-search-deepseek` 目标行由官方 `@deepseek-ai/dsh-base` 提供；在缺少这些行的手工 profile 上，loader 会告警并跳过对应条目（钉住不生效），而本行仍会因 `inject: ['web']` 等待服务。
- 不支持 Windows 原生安装（建议 WSL）；Node 需满足 `engines.node`。

## 迁移与历史

本包是独立仓库 `dsh-tavily-firecrawl@0.2.0` 的**后继者**：行为等价地移植为原生 TypeScript，并纳入 DSH Plugin Fleet 的包名、行 id 与发布流程。下列旧安装路径**已移除**，且不会被恢复：

- `install.sh` / `uninstall.sh`（基于符号链接与文件复制的 profile 安装，舰队禁止）；
- `tavily-firecrawl.patch.yml`、`enable-web-fetch-default.patch.yml`（重复/叠加的 patch 形态）；
- `presets/standard-web`（官方预设的 fork；DSH ≥ 0.1.5 的自带预设已设 `tool-web.fetch: true`，fork 只会带来漂移风险；且 `$DSH_HOME/.agent-presets/` 目录已不被任何组件读取——现代预设是 bundle 声明的 `preset-<id>` 行，旧安装脚本"复制目录即生效"的动作在当前 DSH 上是无效操作）；
- 打包的旧 `*.tgz`。

**迁移顺序**：由用户先在 Desktop Client/Web UI **Plugins/插件管理**中确认备份与依赖，然后卸载自己安装的旧独立包 `dsh-tavily-firecrawl`；再在同一界面选择已验证可安装的新包 `@skillre/dsh-plugin-tavily-firecrawl@<version>`，确认安装并检查 provider 状态。两者都会向 `ctx.web` 注册 id 为 `tavily` / `firecrawl` 的 provider，并存时第二个 `apply` 会因 `WEB_DUPLICATE_PROVIDER` 失败。开发者/agent 不代用户卸载已有插件或代装新包；管理界面不可用时只有经用户授权的恢复流程才可使用 CLI。

## License

MIT
