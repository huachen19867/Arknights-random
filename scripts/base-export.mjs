import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BASE_FIELDS,
  BASE_MODULE_VERIFIED_FIELD,
  BASE_SKILL_FIELDS,
  BASE_SKILL_VERIFIED_FIELD,
  MODULE_FIELDS,
  MODULE_TABLE_NAME,
  createDataset,
  inferPortraitKind,
  larkDateTimeToIso,
  parseArgs,
  readPortraitExceptions,
  unwrapCellValue,
  unwrapUrlCellValue,
  validateDataset,
  verifyBaseFieldSchema,
  verifyModuleFieldSchema,
  writeJsonAtomic,
} from './lib/operators.mjs';
import {
  listAllFields,
  listAllRecords,
  listAllTables,
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
    const moduleVerifiedRaw = cell(fields, BASE_MODULE_VERIFIED_FIELD);
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
      && moduleVerifiedRaw !== true
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
    if (moduleVerifiedRaw === true) {
      operator.modules = [];
    }
    operators.push(operator);
  }
  return { operators, skippedBlank, skippedDisabled };
}

export function mergeOperatorModules(operators, moduleRecords) {
  const knownIds = new Set(operators.map((operator) => operator.id));
  const seenModuleIds = new Set();
  const modulesByOperator = new Map();
  let orphanCount = 0;
  for (const record of moduleRecords) {
    const fields = recordFields(record);
    const moduleId = String(unwrapCellValue(fields['模组ID']) ?? '').trim();
    const operatorId = String(unwrapCellValue(fields['干员ID']) ?? '').trim();
    const name = String(unwrapCellValue(fields['模组名称']) ?? '').trim();
    const code = String(unwrapCellValue(fields['分支类型码']) ?? '').trim();
    const indexRaw = unwrapCellValue(fields['展示顺序']);
    const enabled = unwrapCellValue(fields['启用']) === true;
    const sourceUrl = unwrapUrlCellValue(fields['来源URL']);
    if (!operatorId) throw new Error(`模组子表存在缺少干员ID的行: ${moduleId || '未知'}`);
    if (!knownIds.has(operatorId)) {
      orphanCount += 1;
      continue;
    }
    if (!moduleId) throw new Error(`干员 ${operatorId} 的模组行缺少模组ID`);
    if (seenModuleIds.has(moduleId)) throw new Error(`模组ID 重复: ${moduleId}`);
    seenModuleIds.add(moduleId);
    const index = Number(indexRaw);
    if (!Number.isInteger(index) || index < 1) throw new Error(`模组 ${moduleId} 的展示顺序非法: ${indexRaw}`);
    if (!name) throw new Error(`模组 ${moduleId} 缺少名称`);
    const list = modulesByOperator.get(operatorId) ?? [];
    list.push({ id: moduleId, index, name, code, sourceUrl, enabled });
    modulesByOperator.set(operatorId, list);
  }
  if (orphanCount > 0) throw new Error(`模组子表存在 ${orphanCount} 条孤儿模组（干员不存在或未启用），请先在主表确认`);
  for (const operator of operators) {
    const list = modulesByOperator.get(operator.id);
    if (!list) continue;
    list.sort((left, right) => left.index - right.index);
    list.forEach((module, offset) => {
      if (module.index !== offset + 1) throw new Error(`干员 ${operator.id} 的模组展示顺序不连续；顺序必须从 1 开始`);
    });
    operator.modules = list
      .filter((module) => module.enabled)
      .map(({ id, index, name, code, sourceUrl }) => ({ id, index, name, code, sourceUrl }));
  }
  return operators;
}

async function findModuleTableId(baseToken, identity) {
  const tables = await listAllTables({ baseToken, identity });
  return tables.find((table) => (table.name ?? table.table_name) === MODULE_TABLE_NAME)?.table_id ?? tables.find((table) => (table.name ?? table.table_name) === MODULE_TABLE_NAME)?.id;
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
  const moduleTableId = await findModuleTableId(baseToken, identity);
  let moduleCount = 0;
  if (moduleTableId) {
    const moduleFields = await listAllFields({ baseToken, tableId: moduleTableId, identity });
    verifyModuleFieldSchema(moduleFields);
    const moduleRecords = await listAllRecords({
      baseToken,
      tableId: moduleTableId,
      fields: MODULE_FIELDS,
      identity,
    });
    mergeOperatorModules(operators, moduleRecords);
    moduleCount = moduleRecords.length;
  } else {
    console.log('    [warning] 未找到模组子表“干员模组”，本次导出不包含 modules 字段');
  }
  const exceptionPath = path.resolve(SCRIPT_DIRECTORY, '..', 'config', 'portrait-exceptions.json');
  const exceptions = readPortraitExceptions(exceptionPath);
  const portraitKindExceptions = new Set(
    operators.filter((operator) => exceptions[operator.name]).map((operator) => operator.id),
  );
  operators.sort((left, right) => left.id.localeCompare(right.id, 'en'));
  const dataset = createDataset(operators, {
    generatedAt,
    source: { kind: 'lark-base' },
  });
  const report = validateDataset(dataset, {
    minimumCount: 1,
    allowUnknownSkills: true,
    allowUnknownModules: !moduleTableId,
    strictPortraitKinds: ['elite2'],
    portraitKindExceptions,
  });
  if (!report.ok) throw new Error(`Base 导出校验失败:\n- ${report.errors.join('\n- ')}`);
  await writeJsonAtomic(output, dataset);
  console.log(`[3/3] 已安全写入 ${output}`);
  console.log(`    导出 ${operators.length} 名，跳过空 ID ${skippedBlank} 条，跳过未启用 ${skippedDisabled} 条，模组子表 ${moduleCount} 行`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[fatal] ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
