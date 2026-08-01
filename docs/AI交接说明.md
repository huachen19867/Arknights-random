# AI 交接说明｜明日方舟干员随机抽取工具

更新日期：2026-08-01

## 接手时先知道的结论

核心首版已实现并接入正式数据。右侧主按钮的唯一正确文案是“开始抽取”。设置画板 revision 11 新增了“随机技能 是/否”，首版默认“否”。飞书 Base“干员库”是干员数据正式维护源；PRTS 只用于初始化和发现新增干员；浏览器只读取 Base 导出的静态快照。

工程根目录是 `D:\AI\Codex\Design\Arknights random`，当前不是 Git 仓库。不要运行会覆盖用户文件的 Git 恢复命令，也不要重建 Base 或重新灌入 423 条数据。

## 已完成

前端包含抽取主界面、设置页和独立 Ban 页。默认星级 1–6 全选、八职业全选、人数 12、随机技能关闭；设置与 Ban 由 `rhodes-randomizer.settings.v1` 持久化，旧设置缺 `randomSkill` 时自动迁移为关闭。候选池使用星级、职业、启用和 Ban ID 取交集，抽取使用 `crypto.getRandomValues` 与 Fisher–Yates，单轮不重复。随机技能开启后，每名结果独立随机一个实际技能并固定在本轮 `DrawResult`；`skills: []` 显示“无技能”，字段缺失显示“技能未收录”。候选不足、空候选、正式快照失败、单张图片失败和安全随机 API 失败均有可理解的恢复表现。

正式快照 [operators.json](../public/data/operators.json) 有 423 名干员、423 个唯一 ID、0 个空立绘 URL、0 个未知技能。战斗技能数量 0 / 1 / 2 / 3 的分布为 16 / 17 / 255 / 135。阿米娅三形态当前使用 `R001:术师`、`R001:医疗`、`R001:近卫`，这些 ID 此后按不透明稳定值继承，即使职业变化也不重算。当前 Base 重跑预览为新建 0、更新 0、差异 0。

数据脚本已经覆盖 PRTS 列表与技能解析、真实样本检查、稳定 ID 对账、新增/移除/字段变化报告、旧记录消失与大批变化保护、立绘 URL 探测、数据校验、Base 缺失记录补建、技能组单独预览/写入、Base 全量分页导出、二维矩阵响应、Markdown URL、严格启用、空白行/半填行、方法级限流退避和原子写入。无变化同步不会刷新全部记录的 `updatedAt`。

## 飞书资源

- 知识库节点：https://my.feishu.cn/wiki/Zb7KwXVTDiYLDqke6CkcsCnpnwc
- Base token：`AamibXOoha1bVmssWOQcTsSBncg`
- 表名：`干员数据`
- Table ID：`tblEbnx3MFvghTfD`
- 视图名：`全部干员`
- 字段：干员ID、名称、星级、职业、启用、立绘URL、来源URL、同步时间、技能1、技能2、技能3、技能已核验、立绘附件

这些是资源标识，不是密钥。不要把 access token、app secret、授权链接、device code 或二维码写入工程。

## 已验证

2026-08-01 最终验证结果：

```text
npm.cmd run data:test  -> 44 assertions passed
npm.cmd test           -> 3 files, 18 tests passed
npm.cmd run build      -> Vite 8.2.0 build passed
```

Edge Headless 已在 1440 × 900 和 390 × 844 验证主界面、设置、Ban、正常 12 人抽取、随机技能卡片、1 星候选不足、空候选和手机布局。正式页面初始候选 423；12 人抽取结果 12 个唯一且开启随机技能时每卡显示“技能 N · 名称”；只选 1 星时候选 11，结果 11 个唯一；Ban `KZ15` 后候选变为 422。手机端 body 无横向溢出，卡组内部可横向滚动。

当前 Base 已正式导出并与 PRTS 种子对 id、名称、星级、职业、立绘、来源和技能逐字段比对：423 对 423，差异 0。Base 技能字段初次回填时遇到方法级限流，脚本依靠幂等差异只补未成功记录；最终只读预览为 0 / 0 / 0。限流处理现已支持 `1254290` / `1254291` 和明确的方法级限流文本，默认每批 100 条、批次间 1200ms。

## 尚未实现与不要误报的边界

“立绘附件”是预留字段，当前导出器不读取或下载附件。人工立绘请维护到“立绘URL”，且 URL 必须无需飞书鉴权。

快照中的立绘是 PRTS 媒体 CDN WebP URL，不是本地图片。断网后已打包 JSON 仍可筛选和抽取，但未缓存的立绘会显示文字占位。完全离线图片本地化不是当前首版的一部分。

没有建立 Git 仓库、CI、线上部署或公开访问链接。老板要求的是完成核心功能和可复现交接，本轮没有擅自发布。

没有做有意修改普通业务字段再恢复的破坏性端到端用例；本轮只为已确认的新技能结构创建字段并按预览回填技能数据。若后续必须测试名称、启用或立绘修改实时反映，先选一条专用测试记录或与老板确认修改对象和回滚窗口。

## 下一条安全命令

新 AI 接手后先在工程根目录运行：

```powershell
npm.cmd run data:test
npm.cmd test
npm.cmd run build
```

这三条不修改飞书 Base。只有需要核对线上 Base 时，再从配置文件注入资源 ID 后运行只读导出：

```powershell
$config = Get-Content .\config\feishu-base.json -Raw | ConvertFrom-Json
$env:LARK_BASE_TOKEN = $config.baseToken
$env:LARK_TABLE_ID = $config.tableId
$env:LARK_AS = 'user'
npm.cmd run data:base:export
```

核对 PRTS 官方新增时先运行 `npm.cmd run data:prts` 和 `npm.cmd run data:prts:samples`，查看 `scripts/data/prts-diff.json`；默认保护会阻止旧干员消失和异常大批变化覆盖旧种子。不要直接运行 `data:base:write` 或 `data:base:skills:write`，它们会写飞书。先运行对应 preview 并查看 `scripts/data/base-diff.json`，确认目标和影响后再决定。

## 关键文件索引

| 领域 | 文件 |
|---|---|
| 应用入口与路由 | [src/App.tsx](../src/App.tsx) |
| 抽取主界面 | [src/pages/DrawPage.tsx](../src/pages/DrawPage.tsx) |
| 设置页 | [src/pages/SettingsPage.tsx](../src/pages/SettingsPage.tsx) |
| Ban 页 | [src/pages/BanPage.tsx](../src/pages/BanPage.tsx) |
| 筛选与随机算法 | [src/lib/operators.ts](../src/lib/operators.ts) |
| 本地设置 | [src/lib/settings.ts](../src/lib/settings.ts) |
| 正式快照加载 | [src/hooks/useOperatorData.ts](../src/hooks/useOperatorData.ts) |
| PRTS 同步 | [scripts/sync-prts.mjs](../scripts/sync-prts.mjs) |
| PRTS 真实样本检查 | [scripts/check-prts-samples.mjs](../scripts/check-prts-samples.mjs) |
| PRTS → Base 预览/写入 | [scripts/base-upsert.mjs](../scripts/base-upsert.mjs) |
| Base → 网页快照 | [scripts/base-export.mjs](../scripts/base-export.mjs) |
| 数据规则与原子写入 | [scripts/lib/operators.mjs](../scripts/lib/operators.mjs) |
| 飞书 CLI 分页与信封 | [scripts/lib/lark-cli.mjs](../scripts/lib/lark-cli.mjs) |
| 数据自检 | [scripts/self-test.mjs](../scripts/self-test.mjs) |
| Base 配置 | [config/feishu-base.json](../config/feishu-base.json) |
| 正式生成数据 | [public/data/operators.json](../public/data/operators.json) |
| 最新设置画板快照 | [docs/设置界面画板-20260801.jpg](设置界面画板-20260801.jpg) |
| 画板原始节点 | [scripts/data/whiteboard-raw.json](../scripts/data/whiteboard-raw.json) |
| 完整复现说明 | [README.md](../README.md) |
| 技术判断与坑点 | [docs/技术日志.md](技术日志.md) |
| 验收基线 | [docs/验收清单.md](验收清单.md) |

## 修改原则

Base 已是人工维护源。后续 PRTS 同步默认只补建缺失 ID，不能无提示覆盖已有记录，更不能覆盖“启用”或附件；技能四字段只通过独立 `--update-skills` 流程更新。`public/data/operators.json`、`scripts/data/prts-operators.json`、`scripts/data/prts-diff.json` 和 `scripts/data/base-diff.json` 都是生成物，不要手改。

如果增加本地立绘下载，必须先在数据模型和 README 中明确“附件优先还是 URL 优先”、文件命名、缓存策略、失败回滚和子路径 URL，再实现下载；不能把临时鉴权 URL 或本机绝对路径写入快照。
