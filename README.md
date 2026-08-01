# 明日方舟干员随机抽取工具

这是一个已经接入完整干员库的静态网页工具。主界面按 2 × 6 卡位展示抽取结果，右侧主按钮文字为“开始抽取”；设置页支持星级、职业、1–12 人数量、“随机技能 是/否”与“随机模组 是/否”，Ban 页支持名称、星级、职业筛选。设置与 Ban 名单保存在当前浏览器的 `localStorage`。

正式数据维护源是飞书 Base“干员库”，网页运行时读取由 Base 导出的静态快照，不携带飞书凭证，也不直接访问飞书 API。PRTS 只用于初始化和发现新增干员。

## 当前状态

2026-08-02 已验证 423 名启用干员、423 个唯一 ID、0 个空立绘 URL、0 个未知技能或模组数据。战斗技能数量分布为 0 / 1 / 2 / 3 个技能分别 16 / 17 / 255 / 135 名；夜刀等低星干员的 `skills: []` 表示 PRTS 已确认没有战斗技能，不是漏抓。正式立绘已统一迁移为精零（`_1.png`，421 名）；阿米娅(医疗)/(近卫) 因 PRTS 无精零立绘文件登记为精二例外（见 config/portrait-exceptions.json）。模组数据已采集：无模组 43 名、1 个 285 名、2 个 80 名、3 个 15 名，unknown 0。数据自检 62 项、前端测试 22 项和子路径生产构建均通过。桌面 1440 × 900、手机 390 × 844 下已实际检查主界面、设置页、Ban 页、正常抽取、随机技能/模组卡片、候选不足和空候选状态。

在线地址：<https://huachen19867.github.io/Arknights-random/> 。仓库推送到 `main` 后会由 GitHub Actions 自动复跑数据校验、前端测试和子路径构建，并部署到 GitHub Pages。

飞书资源：

- [知识库中的干员库](https://my.feishu.cn/wiki/Zb7KwXVTDiYLDqke6CkcsCnpnwc)
- Base token：`AamibXOoha1bVmssWOQcTsSBncg`
- 数据表：`干员数据`（`tblEbnx3MFvghTfD`）
- 非密钥字段映射：[config/feishu-base.json](config/feishu-base.json)

## 环境要求

Node.js 需满足 `^20.19.0 || >=22.12.0`，推荐使用当前已验证的 Node.js 24。飞书数据命令还要求本机已安装 `lark-cli`，并且用户身份有权访问上述 Base。

首次安装和本地启动：

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run data:test
npm.cmd run dev
```

打开 Vite 输出的本地地址即可。生产构建与预览：

```powershell
npm.cmd run build
npm.cmd run preview -- --host 127.0.0.1
```

## 飞书维护与导出

日常在飞书“干员数据”表维护名称、星级、职业、启用、立绘 URL 和技能1–3。技能列已经核对完毕时勾选“技能已核验”；三列全空且已勾选表示该干员确实没有战斗技能，未勾选表示技能数据未知。模组维护在子表“干员模组”（一行一个模组），主表勾选“模组已核验”表示该干员模组状态已核对；子表无记录且已勾选表示该干员确实没有模组。网页不会自动读取刚保存的 Base；维护完成后必须重新导出快照并构建。

先从配置文件注入非密钥资源 ID：

```powershell
$config = Get-Content .\config\feishu-base.json -Raw | ConvertFrom-Json
$env:LARK_BASE_TOKEN = $config.baseToken
$env:LARK_TABLE_ID = $config.tableId
$env:LARK_AS = 'user'
```

检查飞书登录状态：

```powershell
lark-cli auth status --json --verify
```

若命令明确返回缺少 scope，按错误中的 `missing_scopes` 重新发起最小权限授权；不要把 access token、app secret、授权链接或二维码保存进工程。

从 Base 重新生成网页快照并复验：

```powershell
npm.cmd run data:base:export
npm.cmd run data:test
npm.cmd test
npm.cmd run build
```

导出只接纳 `启用 === true` 的记录，全空行会跳过，半填行、重复 ID、非法星级或未知职业会让命令非零退出。正式输出为 [public/data/operators.json](public/data/operators.json)，该文件是生成物，不要手工修改。

## PRTS 更新链路

PRTS 更新先生成本地种子，再预览与 Base 的差异。默认不会覆盖 Base 中已有记录，因此 Base 始终是人工维护源。

```powershell
npm.cmd run data:prts
npm.cmd run data:prts:samples
npm.cmd run data:base:preview
```

确认差异后，只有下面的显式命令才会补建 Base 中缺失的干员：

```powershell
npm.cmd run data:base:write
```

已有记录默认只写入 [scripts/data/base-diff.json](scripts/data/base-diff.json) 供复核。`--update-existing` 才允许更新基础字段；立绘 URL 还需同时加 `--update-portrait-url`。技能1–3和“技能已核验”是独立数据组，只有 `npm.cmd run data:base:skills:preview` 预览、确认后再运行 `npm.cmd run data:base:skills:write` 才会更新。模组是另一个独立数据组：先 `npm.cmd run data:base:modules:init`（dry-run）再 `npm.cmd run data:base:modules:init:yes` 初始化字段与子表，之后用 `npm.cmd run data:base:modules:preview` 预览、`npm.cmd run data:base:modules:write` 只新增缺失模组行并勾选核验。同步永不覆盖“启用”和“立绘附件”。

PRTS 同步把上一版种子当作稳定 ID 登记表：已有干员继承旧 ID，新增干员或新形态才分配新 ID。每次生成 [scripts/data/prts-diff.json](scripts/data/prts-diff.json)，默认拒绝旧干员消失，并对单次新增和变化设安全上限；无内容变化的记录保留旧 `updatedAt`，因此连续同步和 Base 预览均可保持 0 差异。详细参数与人工确认边界见 [scripts/README.md](scripts/README.md)。

## Base 字段

主表包含 14 个字段：干员ID、名称、星级、职业、启用、立绘URL、来源URL、同步时间、技能1、技能2、技能3、技能已核验、模组已核验、立绘附件。网页核心链路使用除“立绘附件”外的 13 个字段；附件是预留字段，当前导出器不会读取或发布附件，人工立绘请维护为无需鉴权的 HTTPS URL。模组子表“干员模组”字段为：模组ID、干员ID、模组名称、分支类型码、展示顺序、启用、来源URL、同步时间；其中模组ID 是稳定主键（干员稳定 ID + 分支类型码，如 `R001:医疗:INC-X`）。

`启用` 必须严格为勾选状态才会进入网页。星级只能是 1–6 的整数，职业只能是先锋、近卫、重装、狙击、术师、医疗、辅助、特种。

## 文件边界

手写代码集中在 `src/`、`scripts/`、`config/` 和 `docs/`。以下文件是生成物：

- `scripts/data/prts-operators.json`：`data:prts` 生成的 PRTS 种子。
- `scripts/data/prts-diff.json`：PRTS 新增、移除、字段变化和复用统计报告。
- `scripts/data/base-diff.json`：Base 预览生成的差异报告。
- `public/data/operators.json`：`data:base:export` 生成的网页正式快照。
- `dist/`：`build` 生成的部署产物。

部署到子路径时可使用 Vite 的 `--base` 参数，例如：

```powershell
npm.cmd run build -- --base=/arknights-random/
```

数据 URL 通过 `import.meta.env.BASE_URL` 解析，不依赖站点根路径。

## 已知边界

当前快照中的立绘是 PRTS 媒体 CDN 的 HTTPS URL（精零 800px WebP，少数原图宽度不足的干员用 PNG 原图），不是随 `dist/` 打包的本地图片。因此断开网络后仍可加载快照、筛选和抽取，但未缓存的立绘会显示文字占位。若项目需要完全离线发布，下一阶段应增加图片下载、校验和本地路径改写流程。

PRTS 不是正式 API，页面结构变化可能破坏同步；脚本已使用真实样本检查、全量结构校验、稳定 ID 对账、版本迁移保护、有限重试和原子写入保护上一份可用数据。Base 批量更新还会只针对 `1254290` / `1254291` 或明确的方法级限流做指数退避。项目属于非官方、非商业粉丝工具，发布时须保留 PRTS 来源和素材权属声明。

实现细节见 [docs/实现方案.md](docs/实现方案.md)，验证证据见 [docs/验收清单.md](docs/验收清单.md)，后续 AI 从 [docs/AI交接说明.md](docs/AI交接说明.md) 开始接手。
