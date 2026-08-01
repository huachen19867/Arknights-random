import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, '..', '..');
const TEMP_DIRECTORY = path.join(PROJECT_ROOT, 'scripts', '.tmp');

export class LarkCliError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'LarkCliError';
    Object.assign(this, details);
  }
}

function findLarkExecutable() {
  if (process.env.LARK_CLI_PATH) return process.env.LARK_CLI_PATH;
  if (process.platform !== 'win32') return 'lark-cli';

  const located = spawnSync('where.exe', ['lark-cli.cmd'], { encoding: 'utf8' });
  const commandPath = located.stdout?.split(/\r?\n/).find(Boolean);
  if (commandPath) {
    const executable = path.join(
      path.dirname(commandPath.trim()),
      'node_modules',
      '@larksuite',
      'cli',
      'bin',
      'lark-cli.exe',
    );
    if (existsSync(executable)) return executable;
  }
  throw new Error('找不到 lark-cli.exe；请安装 lark-cli 或设置 LARK_CLI_PATH');
}

function parseEnvelope(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error(`lark-cli 未返回可解析 JSON: ${trimmed.slice(0, 300)}`);
  }
}

async function createJsonArgument(payload) {
  await mkdir(TEMP_DIRECTORY, { recursive: true });
  const filename = `lark-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`;
  const absolutePath = path.join(TEMP_DIRECTORY, filename);
  await writeFile(absolutePath, JSON.stringify(payload), 'utf8');
  const relativePath = path.relative(PROJECT_ROOT, absolutePath);
  return { argument: `@${relativePath}`, absolutePath };
}

export async function runLark(arguments_, options = {}) {
  const args = [...arguments_];
  let temporary;
  if (options.jsonPayload !== undefined) {
    temporary = await createJsonArgument(options.jsonPayload);
    args.push('--json', temporary.argument);
  }
  if (!args.includes('--format') && !args.includes('--json')) args.push('--format', 'json');

  try {
    const result = spawnSync(findLarkExecutable(), args, {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      env: {
        ...process.env,
        LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
        LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
      },
    });
    if (result.error) throw result.error;
    const envelope = parseEnvelope(result.status === 0 ? result.stdout : result.stderr || result.stdout);
    if (result.status !== 0 || envelope?.ok !== true) {
      const error = envelope?.error ?? {};
      throw new LarkCliError(error.message ?? `lark-cli 退出码 ${result.status}`, {
        exitCode: result.status,
        envelope,
        code: error.code,
        subtype: error.subtype,
      });
    }
    return envelope;
  } finally {
    if (temporary) await rm(temporary.absolutePath, { force: true });
  }
}

function dataCandidates(envelope) {
  return [envelope?.data, envelope?.data?.data, envelope, envelope?.meta].filter(Boolean);
}

export function extractArray(envelope, keys) {
  for (const candidate of dataCandidates(envelope)) {
    if (Array.isArray(candidate)) return candidate;
    for (const key of keys) {
      if (Array.isArray(candidate[key])) return candidate[key];
    }
  }
  return [];
}

export function extractHasMore(envelope, received, limit, requestedOffset = 0) {
  for (const candidate of dataCandidates(envelope)) {
    for (const key of ['has_more', 'hasMore']) {
      if (typeof candidate[key] === 'boolean') return candidate[key];
    }
    const total = Number(candidate.total ?? candidate.total_count ?? candidate.totalCount);
    const offset = Number(candidate.offset ?? requestedOffset);
    if (Number.isFinite(total) && total >= 0) return offset + received < total;
  }
  return received === limit;
}

export async function listAllTables({ baseToken, identity = 'user' }) {
  const tables = [];
  const limit = 100;
  for (let offset = 0; ; offset += limit) {
    const envelope = await runLark([
      'base', '+table-list',
      '--base-token', baseToken,
      '--limit', String(limit),
      '--offset', String(offset),
      '--as', identity,
      '--format', 'json',
    ]);
    const page = extractArray(envelope, ['items', 'tables']);
    tables.push(...page);
    if (!extractHasMore(envelope, page.length, limit, offset)) break;
    if (page.length === 0) throw new Error('飞书表分页返回空页但 has_more=true');
  }
  return tables;
}

export async function listAllFields({ baseToken, tableId, identity = 'user' }) {
  const fields = [];
  const limit = 200;
  for (let offset = 0; ; offset += limit) {
    const envelope = await runLark([
      'base', '+field-list',
      '--base-token', baseToken,
      '--table-id', tableId,
      '--limit', String(limit),
      '--offset', String(offset),
      '--as', identity,
      '--format', 'json',
    ]);
    const page = extractArray(envelope, ['items', 'fields']);
    fields.push(...page);
    if (!extractHasMore(envelope, page.length, limit, offset)) break;
    if (page.length === 0) throw new Error('飞书字段分页返回空页但 has_more=true');
  }
  return fields;
}

export async function listAllRecords({ baseToken, tableId, fields, identity = 'user' }) {
  const records = [];
  const limit = 200;
  for (let offset = 0; ; offset += limit) {
    const args = [
      'base', '+record-list',
      '--base-token', baseToken,
      '--table-id', tableId,
      '--limit', String(limit),
      '--offset', String(offset),
      '--as', identity,
      '--format', 'json',
    ];
    for (const field of fields) args.push('--field-id', field);
    const envelope = await runLark(args);
    const page = normalizeRecordPage(envelope);
    records.push(...page);
    if (!extractHasMore(envelope, page.length, limit, offset)) break;
    if (page.length === 0) throw new Error('飞书记录分页返回空页但 has_more=true');
  }
  return records;
}

export function normalizeRecordPage(envelope) {
  const data = envelope?.data;
  if (
    data
    && Array.isArray(data.data)
    && Array.isArray(data.fields)
    && Array.isArray(data.record_id_list)
  ) {
    if (data.data.length !== data.record_id_list.length) {
      throw new Error('飞书记录矩阵行数与 record_id_list 长度不一致');
    }
    return data.data.map((row, rowIndex) => {
      if (!Array.isArray(row)) throw new Error(`飞书记录矩阵第 ${rowIndex} 行不是数组`);
      if (row.length !== data.fields.length) {
        throw new Error(`飞书记录矩阵第 ${rowIndex} 行列数与 fields 长度不一致`);
      }
      return {
        record_id: data.record_id_list[rowIndex],
        fields: Object.fromEntries(data.fields.map((field, columnIndex) => [field, row[columnIndex]])),
      };
    });
  }
  return extractArray(envelope, ['items', 'records']);
}

export function fieldName(field) {
  return field?.field_name ?? field?.name ?? field?.fieldName;
}

export function recordId(record) {
  return record?.record_id ?? record?.recordId ?? record?.id;
}

export function recordFields(record) {
  return record?.fields ?? record?.record?.fields ?? {};
}

function ignoredFields(value, found = []) {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    for (const item of value) ignoredFields(item, found);
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    if ((key === 'ignored_fields' || key === 'ignoredFields') && child && Object.keys(child).length > 0) {
      found.push(child);
    } else {
      ignoredFields(child, found);
    }
  }
  return found;
}

export function assertNoIgnoredFields(envelope) {
  const ignored = ignoredFields(envelope);
  if (ignored.length > 0) {
    throw new Error(`飞书忽略了部分字段: ${JSON.stringify(ignored)}`);
  }
}

export function isRetryableLarkWriteLimit(error) {
  if (!(error instanceof LarkCliError)) return false;
  if ([1254290, 1254291].includes(Number(error.code))) return true;
  const details = `${error.message ?? ''} ${error.subtype ?? ''} ${JSON.stringify(error.envelope?.error ?? {})}`;
  return /OpenAPIBatch(?:Create|Update)Records\s+limited/i.test(details)
    || /rate[_ -]?limit(?:ed|ing)?/i.test(details)
    || /too many requests/i.test(details);
}

export async function runWriteWithRetry(args, jsonPayload, options = {}) {
  const attempts = Number(options.attempts ?? 5);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const envelope = await runLark(args, { jsonPayload });
      assertNoIgnoredFields(envelope);
      return envelope;
    } catch (error) {
      if (!isRetryableLarkWriteLimit(error) || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1_500 * (2 ** (attempt - 1))));
    }
  }
  throw new Error('不可达');
}
