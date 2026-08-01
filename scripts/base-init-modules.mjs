import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BASE_MODULE_VERIFIED_FIELD,
  MODULE_FIELDS,
  MODULE_TABLE_NAME,
  parseArgs,
  verifyBaseFieldSchema,
  verifyModuleFieldSchema,
} from './lib/operators.mjs';
import {
  listAllFields,
  listAllTables,
  runLark,
} from './lib/lark-cli.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/base-init-modules.mjs [--yes] [--dry-run]');
    console.log('在主表增加“模组已核验”复选框，并新建“干员模组”子表（幂等：已存在则校验跳过）。');
    console.log('--yes 才实际写入飞书；默认只打印计划（--dry-run）。');
    console.log('Env: LARK_BASE_TOKEN, LARK_TABLE_ID, optional LARK_AS=user');
    return;
  }
  const baseToken = requiredEnvironment('LARK_BASE_TOKEN');
  const tableId = requiredEnvironment('LARK_TABLE_ID');
  const identity = process.env.LARK_AS?.trim() || 'user';
  const commit = Boolean(args.yes);
  if (!commit) console.log('[dry-run] 未传 --yes，只打印计划');

  console.log('[1/3] 检查主表字段');
  const mainFields = await listAllFields({ baseToken, tableId, identity });
  const mainByName = new Map(mainFields.map((field) => [
    field?.field_name ?? field?.name ?? field?.fieldName,
    field,
  ]));
  if (mainByName.has(BASE_MODULE_VERIFIED_FIELD)) {
    console.log(`    主表已存在 ${BASE_MODULE_VERIFIED_FIELD}，跳过创建`);
    verifyBaseFieldSchema(mainFields);
  } else {
    const payload = JSON.stringify({ name: BASE_MODULE_VERIFIED_FIELD, type: 'checkbox' });
    console.log(`    将创建主表字段 ${BASE_MODULE_VERIFIED_FIELD} (checkbox)`);
    console.log(`      lark-cli base +field-create --table-id ${tableId} --json '${payload}'`);
    if (commit) {
      const envelope = await runLark([
        'base', '+field-create',
        '--base-token', baseToken,
        '--table-id', tableId,
        '--as', identity,
        '--json', payload,
      ]);
      console.log('    字段已创建:', JSON.stringify(envelope?.data ?? envelope).slice(0, 200));
    }
  }

  console.log('[2/3] 检查模组子表');
  const tables = await listAllTables({ baseToken, identity });
  let moduleTableId = tables.find((table) => (table.name ?? table.table_name) === MODULE_TABLE_NAME)?.table_id ?? tables.find((table) => (table.name ?? table.table_name) === MODULE_TABLE_NAME)?.id;
  if (moduleTableId) {
    console.log(`    子表 ${MODULE_TABLE_NAME} 已存在 (${moduleTableId})，校验字段`);
    const moduleFields = await listAllFields({ baseToken, tableId: moduleTableId, identity });
    verifyModuleFieldSchema(moduleFields);
    console.log('    子表字段校验通过');
  } else {
    const fieldsJson = JSON.stringify(MODULE_FIELDS.map((name) => {
      const typeMap = {
        '模组ID': 'text',
        '干员ID': 'text',
        '模组名称': 'text',
        '分支类型码': 'text',
        '展示顺序': 'number',
        '启用': 'checkbox',
        '来源URL': 'url',
        '同步时间': 'datetime',
      };
      const field = { name, type: typeMap[name] };
      if (name === '\u6e90URL') field.style = { type: 'url' };
      return field;
    }));
    console.log(`    将创建子表 ${MODULE_TABLE_NAME}`);
    console.log(`      lark-cli base +table-create --name '${MODULE_TABLE_NAME}' --fields '${fieldsJson}'`);
    if (commit) {
      const envelope = await runLark([
        'base', '+table-create',
        '--base-token', baseToken,
        '--name', MODULE_TABLE_NAME,
        '--as', identity,
        '--fields', fieldsJson,
      ]);
      const createdData = envelope?.data ?? {};
      moduleTableId = createdData?.table_id
        ?? createdData?.table?.table_id
        ?? createdData?.table?.id
        ?? createdData?.id
        ?? createdData?.tables?.[0]?.id;
      console.log('    子表已创建:', JSON.stringify(envelope?.data ?? envelope).slice(0, 300));
      if (!moduleTableId) throw new Error('未取到新子表 table_id，请检查输出');
    }
  }

  console.log('[3/3] 完成。建议下一步：');
  console.log('  npm.cmd run data:base:modules:preview   # 查看主表核验与子表行差异');
  console.log('  确认后 npm.cmd run data:base:modules:write');
}

main().catch((error) => {
  console.error(`[fatal] ${error.stack ?? error.message}`);
  process.exitCode = 1;
});
