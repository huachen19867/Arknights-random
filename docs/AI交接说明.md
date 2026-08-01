# AI 交接说明｜明日方舟干员随机抽取工具

更新日期：2026-08-01

## 接手时先知道的结论

核心首版已实现并接入正式数据。右侧主按钮的唯一正确文案是“开始抽取”。设置画板 revision 11 新增了“随机技能 是/否”，首版默认“否”。飞书 Base“干员库”是干员数据正式维护源；PRTS 只用于初始化和发现新增干员；浏览器只读取 Base 导出的静态快照。

正式立绘已统一改为精零（`_1.png`，kind 记 `elite0`），PRTS 种子侧迁移完成（421 名精零 + 2 名例外）。模组数据已按 PRTS 采集到种子：0 / 1 / 2 / 3 个模组分布为 43 / 285 / 80 / 15，unknown 0。这两部分已写入飞书 Base（立绘 URL 388 条精二→精零、主表“模组已核验”复选框、子表“干员模组”490 行），正式快照 public/data/operators.json 已重新导出并与 PRTS 种子 0 差异。

工程根目录是 `D:\AI\Codex\Design\Arknights random`，当前是 Git 仓库（私有备份 huachen19867/Arknights-random，一次提交）。不要运行会覆盖用户文件的 Git 恢复命令，也不要重建 Base 或重新灌入 423 条数据。

## 已完成

前端包含抽取主界面、设置页和独立 Ban 页。默认星级 1–6 全选、八职业全选、人数 12、随机技能关闭；设置与 Ban 由 `rhodes-randomizer.settings.v1` 持久化，旧设置缺 `randomSkill` 时自动迁移为关闭。候选池使用星级、职业、启用和 Ban ID 取交集，抽取使用 `crypto.getRandomValues` 与 Fisher–Yates，单轮不重复。随机技能开启后，每名结果独立随机一个实际技能并固定在本轮 `DrawResult`；`skills: []` 显示“无技能”，字段缺失显示“技能未收录”。候选不足、空候选、正式快照失败、单张图片失败和安全随机 API 失败均有可理解的恢复表现。

正式快照 [operators.json](../public/data/operators.json) 有 423 名干员、423 个唯一 ID、0 个空立绘 URL、0 个未知技能。战斗技能数量 0 / 1 / 2 / 3 的分布为 16 / 17 / 255 / 135。阿米娅三形态当前使用 `R001:术师`、`R001:医疗`、`R001:近卫`，这些 ID 此后按不透明稳定值继承，即使职业变化也不重算。当前 Base 重跑预览为新建 0、更新 0、差异 0。

数据脚本已经覆盖 PRTS 列表与技能/模组解析、真实样本检查、稳定 ID 对账、新增/移除/字段变化报告、旧记录消失与大批变化保护、立绘 URL 探测、数据校验、Base 缺失记录补建、技能组单独预览/写入、Base 全量分页导出、二维矩阵响应、Markdown URL、严格启用、空白行/半填行、方法级限流退避和原子写入。无变化同步不会刷新全部记录的 `updatedAt`。

精零迁移已完成的本地侧：`portraitCandidates()` 只认 `_1.png`（kind `elite0`），800px 缩略图缺失时降级采用原图 URL；复用条件只认可 URL 完全一致的精零地址；一次性的 `--migrate-portraits-elite0` 参数只允许 portrait/portraitKind/modules 变化并跳过大批变更保护，迁移报告确认其他字段零变化。无精零立绘文件的阿米娅(医疗)/(近卫) 通过 `config/portrait-exceptions.json` 例外回退精二（fallback: elite2），原因已书面记录。莱伊、温米因原图宽度不足 800 自动采用原图 URL（kind 仍为 elite0）。

模组管线的本地侧已实现：`parsePrtsModules()` 先定位“模组”章节，跳过“XXX证章”条目，从 `equiptemplate` 实体区块解析模组名称与分支类型码（支持 `BLA-Δ` 这类希腊字母），无章节视为确实无模组；章节存在但解析不到实体、类型码缺失或重复都会报错。模组 ID 采用“干员稳定 ID + 分支类型码”（如 `R001:医疗:INC-X`）。同步器支持 `--recheck-modules` 与复用已核验模组，并带有“上次有模组、本次解析为空即报错”的防漂移闸门。`validateDataset()` 校验模组数组 ID 唯一、顺序连续、名称非空。前端已实现“随机模组”开关与卡片模组条（深色底+青色左边线），抽取时独立随机模组并写入本轮结果。

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
npm.cmd run data:test  -> 62 assertions passed
npm.cmd test           -> 3 files, 22 tests passed
npm.cmd run build      -> Vite 8.2.0 build passed
```

Edge Headless 已在 1440 × 900 和 390 × 844 验证主界面、设置、Ban、正常 12 人抽取、随机技能卡片、1 星候选不足、空候选和手机布局。正式页面初始候选 423；12 人抽取结果 12 个唯一且开启随机技能时每卡显示“技能 N · 名称”；只选 1 星时候选 11，结果 11 个唯一；Ban `KZ15` 后候选变为 422。手机端 body 无横向溢出，卡组内部可横向滚动。

当前 Base 已正式导出并与 PRTS 种子对 id、名称、星级、职业、立绘、来源和技能逐字段比对：423 对 423，差异 0。Base 技能字段初次回填时遇到方法级限流，脚本依靠幂等差异只补未成功记录；最终只读预览为 0 / 0 / 0。限流处理现已支持 `1254290` / `1254291` 和明确的方法级限流文本，默认每批 100 条、批次间 1200ms。

## 尚未实现与不要误报的边界

“立绘附件”是预留字段，当前导出器不读取或下载附件。人工立绘请维护到“立绘URL”，且 URL 必须无需飞书鉴权。

快照中的立绘是 PRTS 媒体 CDN URL（精零 800px WebP，个别原图宽度不足的干员用 PNG 原图），不是本地图片。断网后已打包 JSON 仍可筛选和抽取，但未缓存的立绘会显示文字占位。完全离线图片本地化不是当前首版的一部分。

Base 已完成迁移：主表有“模组已核验”复选框，子表“干员模组”（tblHn7BCDEiHjRL3）有 490 行模组数据，立绘 URL 已全部更新为精零（阿米娅两形态按例外保持精二），preview 归零，正式快照 `public/data/operators.json` 已重新导出并与 PRTS 种子 0 差异。

前端已实现“随机模组”开关（设置页随机技能旁，默认否）与卡片模组条展示，语义与技能一致（`modules: []` 显示“无模组”，缺字段显示“模组未收录”）。

没有建立 Git 仓库、CI、线上部署或公开访问链接。老板要求的是完成核心功能和可复现交接，本轮没有擅自发布。

没有做有意修改普通业务字段再恢复的破坏性端到端用例；本轮只为已确认的新技能结构创建字段并按预览回填技能数据。若后续必须测试名称、启用或立绘修改实时反映，先选一条专用测试记录或与老板确认修改对象和回滚窗口。

## 下一条安全命令

新 AI 接手后先在工程根目录运行：

```powershell
npm.cmd run data:test
npm.cmd test
npm.cmd run build
npm.cmd run data:prts:samples
```

前三条不修改飞书 Base，样本检查会在线核对技能与模组解析（需要网络）。核对 PRTS 官方新增时先运行 `npm.cmd run data:prts` 查看 `scripts/data/prts-diff.json`；默认保护会阻止旧干员消失和异常大批变化覆盖旧种子。涉及写飞书的命令（`data:base:write`、`data:base:skills:write`、`data:base:modules:init:yes`、`data:base:modules:write`、`data:base:modules:update`）必须先给老板看 preview 摘要并确认写入范围；`data:base:export` 是只读导出，但当前 Base 未迁移（仍有 390 条精二立绘）时会被 strict 校验拒绝，这是预期行为，不是脚本故障。

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
| PRTS 模组解析 | [scripts/lib/operators.mjs](../scripts/lib/operators.mjs) |
| 模组子表初始化 | [scripts/base-init-modules.mjs](../scripts/base-init-modules.mjs) |
| 立绘例外表 | [config/portrait-exceptions.json](../config/portrait-exceptions.json) |
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

精零立绘是唯一正式方案：任何同步路径都不得静默回退到 `_2.png`。只有例外表（config/portrait-exceptions.json）登记过的干员才允许精二，新增例外必须写明原因并先给老板确认。模组更新默认只新增缺失行，官方移除的模组只报告不物理删除，由人工停用或确认。
