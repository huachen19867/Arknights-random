# 干员数据同步脚本

这套脚本把数据流固定为 `PRTS -> 本地标准 JSON -> 飞书 Base -> 前端静态 JSON`。脚本本身使用 Node.js 标准库；按整个工程复现时，Node.js 需满足 `^20.19.0 || >=22.12.0`。Base 命令需要已安装并授权的 `lark-cli`。

## 1. 从 PRTS 生成种子 JSON

```powershell
node .\scripts\self-test.mjs
node .\scripts\sync-prts.mjs
node .\scripts\check-prts-samples.mjs
```

默认产物是 `scripts/data/prts-operators.json`，每次同步另生成 `scripts/data/prts-diff.json`。脚本从 `#filter-data` 提取 `data-id` / `data-zh` / `data-rarity` / `data-profession`，把 PRTS 从 0 开始的稀有度加 1；再读取每个干员详情页的“技能”章节，只提取作战技能编号和名称，不混入后勤技能。1–2 星干员确实可能没有作战技能，因此 `skills: []` 是已核验的有效结果，不等同于字段缺失。只有页面明确写有“该干员没有技能”时才接受空数组；技能标题或小节结构缺失会直接失败，避免把解析漂移冒充无技能。

PRTS 中阿米娅三种形态的 `data-id` 都是 `R001`。脚本保留 `prtsId: "R001"`，并以旧数据对账维持稳定主键；首次分别使用 `R001:术师`、`R001:医疗`和 `R001:近卫`。对账按名称+职业精确匹配、同组名称唯一匹配、同职业唯一匹配、单旧/单新依次收敛，因此改职业和单形态变多形态不会无故改写旧 ID；仍有歧义时由 removal guard 中止，不猜测。

同步默认复用 URL 完全一致的旧精二立绘和已有的完整 `skills` 数组；精一/头像仍重新 HEAD 校验。新增干员、缺少技能或姓名/星级/职业变化时才重新抓详情。只有 `--recheck-portraits` / `--recheck-skills` 才全量复查。没有内容变化的干员保留原 `updatedAt`。

旧版到新版的变化会先经过迁移保护：默认禁止干员消失，单次最多新增 50 名、变更 50 名；异常时只写差异报告，不覆盖上一份可用数据。确认真实大版本变化后才显式调整门槛。

常用参数：

```powershell
node .\scripts\sync-prts.mjs --output .\scripts\data\prts-operators.json --concurrency 4 --width 800 --quality 80
node .\scripts\sync-prts.mjs --recheck-portraits --recheck-skills
node .\scripts\sync-prts.mjs --allow-removals --max-additions 80 --max-changes 80
```

## 2. Base 字段约定

目标表必须存在以下中文字段：`干员ID`、`名称`、`星级`、`职业`、`启用`、`立绘URL`、`来源URL`、`同步时间`、`技能1`、`技能2`、`技能3`、`技能已核验`。前三个技能字段是普通文本，“技能已核验”是复选框；其余类型依次为文本、文本、数字、单选、复选框、超链接、超链接、日期时间。职业单选须预先建好八个选项。当前 Base 另有预留字段“立绘附件”，但导出器不会读取、下载或发布附件；人工立绘请使用无需鉴权的 HTTPS URL。

PowerShell 中设置环境变量：

```powershell
$env:LARK_BASE_TOKEN = 'bascn_xxx'
$env:LARK_TABLE_ID = 'tblxxx'
$env:LARK_AS = 'user'
```

不要把整个 Base URL、Wiki token 或知识库 token 填到 `LARK_BASE_TOKEN`。

本项目的实际非密钥 ID 已记录在 `config/feishu-base.json`，可以直接从该文件注入环境变量：

```powershell
$config = Get-Content .\config\feishu-base.json -Raw | ConvertFrom-Json
$env:LARK_BASE_TOKEN = $config.baseToken
$env:LARK_TABLE_ID = $config.tableId
$env:LARK_AS = 'user'
```

## 3. 批量 upsert 到 Base

先运行预览；预览会读字段和干员 ID，不会写数据：

```powershell
node .\scripts\base-upsert.mjs
```

确认新建/更新数量后再显式执行：

```powershell
node .\scripts\base-upsert.mjs --write
```

脚本先串行分页读取现有记录。Base 是人工维护源：默认只用 `+record-batch-create` 补建缺失 ID，已有记录只在 `scripts/data/base-diff.json` 生成差异，不覆盖。只有显式传入 `--update-existing`才会更新已有的名称、星级、职业、来源 URL 和同步时间；立绘 URL 还需另外传入 `--update-portrait-url`。

技能四字段是不可拆分的数据组。通用 `--update-existing` 不会改动它们；只有单独的 `--update-skills` 才会把技能1–3、技能已核验以及本条同步时间一起更新。先预览，不要未经检查直接追加 `--write`：

```powershell
node .\scripts\base-upsert.mjs --update-skills
# 复核 scripts/data/base-diff.json 后才执行：
node .\scripts\base-upsert.mjs --update-skills --write
```

`启用` 永不被更新，附件字段永不读写。默认每批 100 条、批次间等待 1200ms，同一表的连续写始终串行；可用 `--batch-size`（上限 200）和 `--batch-delay` 调整。遇到 `1254290`、`1254291` 或错误信封明确包含 `OpenAPIBatchCreateRecords/OpenAPIBatchUpdateRecords limited`、rate limit、too many requests 时才指数退避，其他写错误不会泛化重试。所有 CLI 成功判定都是 `ok === true`，不使用旧式 `code == 0`。Base 中如有重复干员 ID，脚本会停止，不猜测要更新哪条。

## 4. Base 导出前端数据

```powershell
node .\scripts\base-export.mjs
```

默认串行分页读取全表，只导出“启用”复选框 CellValue 严格等于 `true` 的记录，校验后原子写入 `public/data/operators.json`。只有“技能已核验”也严格等于 `true` 时才输出 `skills`；三个技能都空且已核验会输出 `skills: []`，未核验则省略 `skills` 表示未知。技能必须从 1 开始连续填写。全空行会跳过，任何已填但缺少必需字段的半填行会立即报错，避免把脏数据发布到前端。当前导出的 `portrait` 保持为 Base 中维护的 HTTPS URL；完全离线发布所需的图片本地化尚未实现。

三个 JSON 入口共用同一数据集形状：顶层包含 `schemaVersion`、`generatedAt`、`source`、`count`、`operators`；干员字段为 `id`、`name`、`rarity`、`profession`、`enabled`、`portrait`、`portraitKind`、`sourceUrl`、`updatedAt`、`skills`。其中 `skills` 元素形如 `{ "index": 1, "name": "真银斩" }`；Base 未核验时该字段可以省略。
