import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BASE_FIELDS,
  BASE_SKILL_FIELDS,
  BASE_SKILL_VERIFIED_FIELD,
  chunk,
  parseArgs,
  readDataset,
  toLarkDateTime,
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/base-upsert.mjs [--input <json>] [--write] [--update-existing] [--update-portrait-url] [--update-skills]');
    console.log('       [--batch-size 100] [--batch-delay 1200]');
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
    if (args['update-existing'] || args['update-skills']) {
      const skillGroupFields = [...BASE_SKILL_FIELDS, BASE_SKILL_VERIFIED_FIELD];
      const updateFields = {};
      if (args['update-existing']) {
        for (const { field, prts } of changes) {
          if (!skillGroupFields.includes(field) && field !== '启用' && (field !== '立绘URL' || args['update-portrait-url'])) {
            updateFields[field] = prts;
          }
        }
      }
      if (args['update-skills'] && changes.some(({ field }) => skillGroupFields.includes(field))) {
        for (const field of skillGroupFields) updateFields[field] = fields[field];
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
    differences,
  };
  await writeJsonAtomic(diffOutput, diffReport);
  console.log(`    计划新建 ${creates.length} 条，显式更新 ${updates.length} 条，已有记录差异 ${differences.length} 条`);
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
  console.log('[3/3] Base upsert 完成；未读取或写入任何附件字段');
}

main().catch((error) => {
  console.error(`[fatal] ${error.stack ?? error.message}`);
  process.exitCode = 1;
});
