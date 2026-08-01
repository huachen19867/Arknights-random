import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BASE_FIELDS,
  BASE_SKILL_FIELDS,
  BASE_SKILL_VERIFIED_FIELD,
  createDataset,
  inferPortraitKind,
  larkDateTimeToIso,
  parseArgs,
  unwrapCellValue,
  unwrapUrlCellValue,
  validateDataset,
  verifyBaseFieldSchema,
  writeJsonAtomic,
} from './lib/operators.mjs';
import {
  listAllFields,
  listAllRecords,
  recordFields,
} from './lib/lark-cli.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = path.resolve(SCRIPT_DIRECTORY, '..', 'public', 'data', 'operators.json');

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function cell(fields, name) {
  return unwrapCellValue(fields[name]);
}

function urlCell(fields, name) {
  return unwrapUrlCellValue(fields[name]);
}

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

export function recordsToOperators(records, generatedAt = new Date().toISOString()) {
  const operators = [];
  const seenIds = new Set();
  let skippedBlank = 0;
  let skippedDisabled = 0;
  for (const record of records) {
    const fields = recordFields(record);
    const enabledRaw = cell(fields, '启用');
    const skillVerifiedRaw = cell(fields, BASE_SKILL_VERIFIED_FIELD);
    const skillValues = BASE_SKILL_FIELDS.map((field) => cell(fields, field));
    const raw = {
      id: cell(fields, '干员ID'),
      name: cell(fields, '名称'),
      rarity: cell(fields, '星级'),
      profession: cell(fields, '职业'),
      portraitUrl: urlCell(fields, '立绘URL'),
      sourceUrl: urlCell(fields, '来源URL'),
      updatedAt: cell(fields, '同步时间'),
    };
    if (
      Object.values(raw).every(isBlank)
      && skillValues.every(isBlank)
      && enabledRaw !== true
      && skillVerifiedRaw !== true
    ) {
      skippedBlank += 1;
      continue;
    }
    const missing = Object.entries(raw).filter(([, value]) => isBlank(value)).map(([key]) => key);
    if (missing.length > 0) {
      throw new Error(`Base 存在半填行，缺少 ${missing.join(', ')}: ${JSON.stringify(raw)}`);
    }
    const id = String(raw.id).trim();
    if (seenIds.has(id)) throw new Error(`Base 中干员 ID 重复: ${id}`);
    seenIds.add(id);
    const enabled = enabledRaw === true;
    if (!enabled) {
      skippedDisabled += 1;
      continue;
    }
    const portraitUrl = String(raw.portraitUrl).trim();
    const operator = {
      id,
      name: String(raw.name).trim(),
      rarity: Number(raw.rarity),
      profession: String(raw.profession).trim(),
      enabled,
      portrait: portraitUrl,
      portraitKind: inferPortraitKind(portraitUrl),
      sourceUrl: String(raw.sourceUrl).trim(),
      updatedAt: larkDateTimeToIso(raw.updatedAt) ?? generatedAt,
    };
    if (skillVerifiedRaw === true) {
      const lastSkillOffset = skillValues.reduce((last, value, offset) => (isBlank(value) ? last : offset), -1);
      const relevantSkills = skillValues.slice(0, lastSkillOffset + 1);
      if (relevantSkills.some(isBlank)) {
        throw new Error(`Base 干员 ${id} 的技能编号不连续；技能1-3 必须从 1 开始连续填写`);
      }
      operator.skills = relevantSkills.map((name, offset) => ({ index: offset + 1, name: String(name).trim() }));
    }
    operators.push(operator);
  }
  return { operators, skippedBlank, skippedDisabled };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/base-export.mjs [--output public/data/operators.json]');
    console.log('Env: LARK_BASE_TOKEN, LARK_TABLE_ID, optional LARK_AS=user');
    return;
  }
  const baseToken = requiredEnvironment('LARK_BASE_TOKEN');
  const tableId = requiredEnvironment('LARK_TABLE_ID');
  const identity = process.env.LARK_AS?.trim() || 'user';
  const output = path.resolve(args.output ?? DEFAULT_OUTPUT);

  console.log('[1/3] 预检 Base 字段');
  verifyBaseFieldSchema(await listAllFields({ baseToken, tableId, identity }));
  console.log('[2/3] 串行分页导出 Base 记录');
  const records = await listAllRecords({ baseToken, tableId, fields: BASE_FIELDS, identity });
  const generatedAt = new Date().toISOString();
  const { operators, skippedBlank, skippedDisabled } = recordsToOperators(records, generatedAt);
  operators.sort((left, right) => left.id.localeCompare(right.id, 'en'));
  const dataset = createDataset(operators, {
    generatedAt,
    source: { kind: 'lark-base' },
  });
  const report = validateDataset(dataset, { minimumCount: 1, allowUnknownSkills: true });
  if (!report.ok) throw new Error(`Base 导出校验失败:\n- ${report.errors.join('\n- ')}`);
  await writeJsonAtomic(output, dataset);
  console.log(`[3/3] 已安全写入 ${output}`);
  console.log(`    导出 ${operators.length} 名，跳过空 ID ${skippedBlank} 条，跳过未启用 ${skippedDisabled} 条`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[fatal] ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
