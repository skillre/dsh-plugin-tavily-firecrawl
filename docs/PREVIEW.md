# 预览图画板

详情页的预览图以**飞书画板**为编辑源，`docs/preview*.svg` 是它的导出快照。
本文件记录两种语言各自对应的画板，供 `node scripts/preview.mjs push|pull` 使用。

> 状态：当前 `docs/preview.svg` 与 `docs/preview.zh.svg` 由手写 SVG 直接绘制，
> 尚未回填到飞书画板。下表的 token 为空即表示「尚未建板」；建板后用 `push` 上传，
> 再把文档 URL 与 token 填回来，此后改图走 `pull` / `push` 往返。

| 语言 | 文档 | 画板 token |
|---|---|---|
| `en` | （待建：飞书文档 URL） | （待建：whiteboard token） |
| `zh` | （待建：飞书文档 URL） | （待建：whiteboard token） |

## 操作

```sh
# 把本地 SVG 推上画板（整板重建）
node scripts/preview.mjs push --lang zh

# 从画板导出 SVG 覆盖本地文件
node scripts/preview.mjs pull --lang zh

# 离线校验（npm run check 会自动调用）
node scripts/preview.mjs check
```

## 画面约定

两张图必须同构，只换语言：

1. **主体**：DSH 里并排的两块真实面板 —— 左 `web_search`（Tavily）、右 `web_fetch`（Firecrawl），
   占据视觉重心，用来回答「这插件把联网能力换成了什么」。
2. **机制**：左侧展示 Tavily 的合成答案 + 带引用的来源卡片（`content` 来自 `answer`，
   snippet 截断 600 字符）；右侧展示 Firecrawl 的 Markdown 正文（`onlyMainContent`、
   正文上限 200000 字符、非 2xx 页面作为结果而非异常）。
3. **关键数据**：底部密钥池条 —— 三把 Tavily 凭据，两把可用、一把 429 冷却中，
   直观说明「多密钥轮询」这个核心卖点；右侧标注另有 firecrawl 池。
4. **细节**：右上角 `active · v0.1.0` 状态徽标；每个面板顶部的强调色条区分搜索（蓝）与抓取（橙）。

规则见 fleet 的 `docs/display-contract.md`。
