import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BASE_FIELDS,
  BASE_MODULE_VERIFIED_FIELD,
  BASE_SKILL_FIELDS,
  BASE_SKILL_VERIFIED_FIELD,
  MODULE_FIELDS,
  MODULE_TABLE_NAME,
  chunk,
  parseArgs,
  readDataset,
  toLarkDateTime,
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
  recordId,
  runWriteWithRetry,
} from './lib/lark-cli.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_INPUT = path.join(SCRIPT_DIRECTORY, 'data', 'prts-operators.json');
const DEFAULT_DIFF_OUTPUT = path.join(SCRIPT_DIRECTORY, 'data', 'base-diff.json');

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function operatorFields(operator, generatedAt) {
  const fields = {
    '干员ID': operator.id,
    '名称': operator.name,
    '星级': operator.rarity,
    '职业': operator.profession,
    '启用': operator.enabled !== false,
    '立绘URL': operator.portrait,
    '来源URL': operator.sourceUrl,
    '同步时间': toLarkDateTime(operator.updatedAt ?? generatedAt),
  };
  for (const field of BASE_SKILL_FIELDS) {
    const index = Number(field.replace('技能', ''));
    fields[field] = operator.skills.find((skill) => skill.index === index)?.name ?? null;
  }
  fields[BASE_SKILL_VERIFIED_FIELD] = true;
  fields[BASE_MODULE_VERIFIED_FIELD] = true;
  return fields;
}

function comparableBaseValue(fields, field) {
  const raw = field.endsWith('URL') ? unwrapUrlCellValue(fields[field]) : unwrapCellValue(fields[field]);
  if (field === '星级') return raw === undefined || raw === null || raw === '' ? undefined : Number(raw);
  return raw === undefined || raw === null ? undefined : String(raw).trim();
}

function diffExisting(record, incoming) {
  const fields = recordFields(record);
  const comparedFields = [
    '名称', '星级', '职业', '立绘URL', '来源URL', '同步时间',
    ...BASE_SKILL_FIELDS,
    BASE_SKILL_VERIFIED_FIELD,
    BASE_MODULE_VERIFIED_FIELD,
  ];
  const changes = [];
  for (const field of comparedFields) {
    const baseValue = comparableBaseValue(fields, field);
    const prtsValue = incoming[field];
    if (String(baseValue ?? '') !== String(prtsValue ?? '')) {
      changes.push({ field, base: baseValue, prts: prtsValue });
    }
  }
  return changes;
}

async function findModuleTableId(baseToken, identity) {
  const tables = await listAllTables({ baseToken, identity });
  const match = tables.find((table) => (table.name ?? table.table_name) === MODULE_TABLE_NAME);
  return match?.table_id ?? match?.id;
}

function buildModuleRows(operator, generatedAt) {
  return (operator.modules ?? []).map((module) => ({
    '模组ID': module.id,
    '干员ID': operator.id,
    '模组名称': module.name,
    '分支类型码': module.code ?? '',
    '展示顺序': module.index,
    '启用': true,
    '来源URL': module.sourceUrl ?? '',
    '同步时间': toLarkDateTime(operator.updatedAt ?? generatedAt),
  }));
}

function comparableModuleValue(record, field) {
  const fields = recordFields(record);
  if (field === '来源URL') return unwrapUrlCellValue(fields[field]) ?? '';
  const value = unwrapCellValue(fields[field]);
  if (field === '展示顺序') return value === undefined || value === null || value === '' ? undefined : Number(value);
  if (field === '启用') return value === true;
  return value === undefined || value === null ? '' : String(value).trim();
}

function computeModuleDiff({ operators, moduleRecords }) {
  const creates = [];
  const updates = [];
  const differences = [];
  const removals = [];
  const existingByModuleId = new Map();
  for (const record of moduleRecords) {
    const moduleId = String(unwrapCellValue(recordFields(record)['模组ID']) ?? '').trim();
    if (!moduleId) continue;
    if (existingByModuleId.has(moduleId)) throw new Error(`模组子表模组ID 重复: ${moduleId}`);
    existingByModuleId.set(moduleId, record);
  }
  const expectedByOperator = new Map();
  for (const operator of operators) {
    expectedByOperator.set(operator.id, buildModuleRows(operator, new Date().toISOString()));
  }
  const expectedRows = [...expectedByOperator.values()].flat();
  const expectedIds = new Set(expectedRows.map((row) => row['模组ID']));
  for (const row of expectedRows) {
    const existing = existingByModuleId.get(row['模组ID']);
    if (!existing) {
      creates.push(row);
      continue;
    }
    const changedFields = MODULE_FIELDS.filter((field) => {
      const baseValue = comparableModuleValue(existing, field);
      const prtsValue = row[field];
      return String(baseValue ?? '') !== String(prtsValue ?? '');
    });
    if (changedFields.length > 0) {
      differences.push({
        moduleId: row['模组ID'],
        operatorId: row['干员ID'],
        recordId: recordId(existing),
        fields: changedFields,
      });
      updates.push([recordId(existing), row]);
    }
  }
  for (const [moduleId, record] of existingByModuleId) {
    if (!expectedIds.has(moduleId)) {
      removals.push({
        moduleId,
        operatorId: String(unwrapCellValue(recordFields(record)['干员ID']) ?? '').trim(),
        recordId: recordId(record),
      });
    }
  }
  return { creates, updates, differences, removals };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/base-upsert.mjs [--input <json>] [--write] [--update-existing] [--update-portrait-url] [--update-skills]');
    console.log('       [--update-modules] [--update-module-existing] [--batch-size 100] [--batch-delay 1200]');
    console.log('Env: LARK_BASE_TOKEN, LARK_TABLE_ID, optional LARK_AS=user');
    return;
  }
  const baseToken = requiredEnvironment('LARK_BASE_TOKEN');
  const tableId = requiredEnvironment('LARK_TABLE_ID');
  const identity = process.env.LARK_AS?.trim() || 'user';
  const input = path.resolve(args.input ?? DEFAULT_INPUT);
  const diffOutput = path.resolve(args['diff-output'] ?? DEFAULT_DIFF_OUTPUT);
  const batchSize = Number(args['batch-size'] ?? 100);
  const batchDelay = Number(args['batch-delay'] ?? 1_200);
  const dataset = await readDataset(input);
  const report = validateDataset(dataset, { minimumCount: 1 });
  if (!report.ok) throw new Error(`输入 JSON 无效:\n- ${report.errors.join('\n- ')}`);
  if (args['update-portrait-url'] && !args['update-existing']) {
    throw new Error('--update-portrait-url 必须与 --update-existing 一起使用');
  }
  if (!Number.isInteger(batchDelay) || batchDelay < 0) throw new Error('--batch-delay 必须是非负整数毫秒');

  console.log('[1/3] 预检 Base 字段');
  verifyBaseFieldSchema(await listAllFields({ baseToken, tableId, identity }));
  console.log('[2/3] 串行分页读取现有干员 ID');
  const existingRecords = await listAllRecords({
    baseToken,
    tableId,
    fields: BASE_FIELDS,
    identity,
  });
  const existingByOperatorId = new Map();
  for (const record of existingRecords) {
    const operatorId = String(unwrapCellValue(recordFields(record)['干员ID']) ?? '').trim();
    if (!operatorId) continue;
    if (existingByOperatorId.has(operatorId)) throw new Error(`Base 中干员 ID 重复: ${operatorId}`);
    existingByOperatorId.set(operatorId, record);
  }

  const moduleTableId = args['update-modules'] ? await findModuleTableId(baseToken, identity) : undefined;
  let moduleRecords = [];
  let moduleVerifyNeeded = 0;
  const moduleCreateAll = [];
  const moduleUpdateAll = [];
  const moduleDiffAll = [];
  const moduleRemovalAll = [];
  if (args['update-modules'] && !moduleTableId) {
    throw new Error('--update-modules 需要模组子表“干员模组”，请先初始化 Base 或去掉该参数');
  }
  if (args['update-modules'] && moduleTableId) {
    console.log('[2.5/3] 读取模组子表');
    verifyModuleFieldSchema(await listAllFields({ baseToken, tableId: moduleTableId, identity }));
    moduleRecords = await listAllRecords({
      baseToken,
      tableId: moduleTableId,
      fields: MODULE_FIELDS,
      identity,
    });
    const moduleDiff = computeModuleDiff({ operators: dataset.operators, moduleRecords });
    moduleCreateAll.push(...moduleDiff.creates);
    moduleUpdateAll.push(...moduleDiff.updates);
    moduleDiffAll.push(...moduleDiff.differences);
    moduleRemovalAll.push(...moduleDiff.removals);
    for (const operator of dataset.operators) {
      const existingRecord = existingByOperatorId.get(operator.id);
      if (!existingRecord) continue;
      const verified = unwrapCellValue(recordFields(existingRecord)[BASE_MODULE_VERIFIED_FIELD]) === true;
      if (!verified) moduleVerifyNeeded += 1;
    }
  }

  const creates = [];
  const updates = [];
  const differences = [];
  for (const operator of dataset.operators) {
    const fields = operatorFields(operator, dataset.generatedAt);
    const existingRecord = existingByOperatorId.get(operator.id);
    if (!existingRecord) {
      creates.push(fields);
      continue;
    }
    const changes = diffExisting(existingRecord, fields);
    if (changes.length === 0) continue;
    differences.push({
      id: operator.id,
      name: operator.name,
      recordId: recordId(existingRecord),
      changes,
    });
    if (args['update-existing'] || args['update-skills'] || args['update-modules']) {
      const skillGroupFields = [...BASE_SKILL_FIELDS, BASE_SKILL_VERIFIED_FIELD];
      const moduleGroupFields = [BASE_MODULE_VERIFIED_FIELD];
      const updateFields = {};
      if (args['update-existing']) {
        for (const { field, prts } of changes) {
          if (!skillGroupFields.includes(field) && !moduleGroupFields.includes(field) && field !== '启用' && (field !== '立绘URL' || args['update-portrait-url'])) {
            updateFields[field] = prts;
          }
        }
      }
      if (args['update-skills'] && changes.some(({ field }) => skillGroupFields.includes(field))) {
        for (const field of skillGroupFields) updateFields[field] = fields[field];
        updateFields['同步时间'] = fields['同步时间'];
      }
      if (args['update-modules'] && changes.some(({ field }) => moduleGroupFields.includes(field))) {
        updateFields[BASE_MODULE_VERIFIED_FIELD] = true;
        updateFields['同步时间'] = fields['同步时间'];
      }
      if (Object.keys(updateFields).length > 0) {
        updates.push([
          recordId(existingRecord),
          updateFields,
        ]);
      }
    }
  }
  const diffReport = {
    generatedAt: new Date().toISOString(),
    input: path.relative(process.cwd(), input).split(path.sep).join('/') || path.basename(input),
    existingCount: existingByOperatorId.size,
    missingCount: creates.length,
    differentCount: differences.length,
    updateExisting: Boolean(args['update-existing']),
    updatePortraitUrl: Boolean(args['update-portrait-url']),
    updateSkills: Boolean(args['update-skills']),
    updateModules: Boolean(args['update-modules']),
    updateModuleExisting: Boolean(args['update-module-existing']),
    differences,
    module: args['update-modules']
      ? {
          tableName: MODULE_TABLE_NAME,
          verifyNeeded: moduleVerifyNeeded,
          createCount: moduleCreateAll.length,
          updateCount: moduleUpdateAll.length,
          differenceCount: moduleDiffAll.length,
          removalCount: moduleRemovalAll.length,
          creates: moduleCreateAll,
          updates: args['update-module-existing'] ? moduleUpdateAll : [],
          differences: moduleDiffAll,
          removals: moduleRemovalAll,
        }
      : undefined,
  };
  await writeJsonAtomic(diffOutput, diffReport);
  console.log(`    计划新建 ${creates.length} 条，显式更新 ${updates.length} 条，已有记录差异 ${differences.length} 条`);
  if (args['update-modules']) {
    console.log(`    模组：需核验 ${moduleVerifyNeeded} 条，新建 ${moduleCreateAll.length} 行，差异 ${moduleDiffAll.length} 行，移除 ${moduleRemovalAll.length} 行`);
  }
  console.log(`    差异报告: ${diffOutput}`);
  if (!args.write) {
    console.log('[3/3] 预览完成；未写入。确认后加 --write 执行。');
    return;
  }

  let batchIndex = 0;
  for (const batch of chunk(creates, batchSize)) {
    batchIndex += 1;
    console.log(`    串行新建批次 ${batchIndex}，${batch.length} 条`);
    await runWriteWithRetry([
      'base', '+record-batch-create',
      '--base-token', baseToken,
      '--table-id', tableId,
      '--as', identity,
      '--format', 'json',
    ], { create_records: batch });
    if (batchDelay > 0) await wait(batchDelay);
  }
  batchIndex = 0;
  for (const batch of chunk(updates, batchSize)) {
    batchIndex += 1;
    console.log(`    串行更新批次 ${batchIndex}，${batch.length} 条`);
    await runWriteWithRetry([
      'base', '+record-batch-update',
      '--base-token', baseToken,
      '--table-id', tableId,
      '--as', identity,
      '--format', 'json',
    ], { update_records: Object.fromEntries(batch) });
    if (batchDelay > 0) await wait(batchDelay);
  }
  if (args['update-modules'] && moduleTableId) {
    let moduleBatchIndex = 0;
    for (const batch of chunk(moduleCreateAll, batchSize)) {
      moduleBatchIndex += 1;
      console.log(`    串行新建模组批次 ${moduleBatchIndex}，${batch.length} 行`);
      await runWriteWithRetry([
        'base', '+record-batch-create',
        '--base-token', baseToken,
        '--table-id', moduleTableId,
        '--as', identity,
        '--format', 'json',
      ], { create_records: batch });
      if (batchDelay > 0) await wait(batchDelay);
    }
    if (args['update-module-existing']) {
      moduleBatchIndex = 0;
      for (const batch of chunk(moduleUpdateAll, batchSize)) {
        moduleBatchIndex += 1;
        console.log(`    串行更新模组批次 ${moduleBatchIndex}，${batch.length} 行`);
        await runWriteWithRetry([
          'base', '+record-batch-update',
          '--base-token', baseToken,
          '--table-id', moduleTableId,
          '--as', identity,
          '--format', 'json',
        ], { update_records: Object.fromEntries(batch) });
        if (batchDelay > 0) await wait(batchDelay);
      }
    }
    if (moduleRemovalAll.length > 0) {
      console.log(`    [注意] ${moduleRemovalAll.length} 个模组疑似被官方移除，未物理删除，请人工判断后停用或确认删除`);
    }
  }
  console.log('[3/3] Base upsert 完成；未读取或写入任何附件字段');
}

main().catch((error) => {
  console.error(`[fatal] ${error.stack ?? error.message}`);
  process.exitCode = 1;
});
