import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDataset,
  parseArgs,
  readDataset,
  unwrapCellValue,
  unwrapUrlCellValue,
  validateDataset,
  writeJsonAtomic,
} from './lib/operators.mjs';
import {
  downloadRecordAttachment,
  listAllRecords,
  recordFields,
  recordId,
} from './lib/lark-cli.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const DEFAULT_INPUT = path.join(PROJECT_ROOT, 'public', 'data', 'operators.json');
const DEFAULT_OUTPUT_DIRECTORY = path.join(PROJECT_ROOT, 'public', 'assets', 'operators');
const DEFAULT_MANIFEST = path.join(DEFAULT_OUTPUT_DIRECTORY, 'manifest.json');
const DEFAULT_REPORT = path.join(PROJECT_ROOT, 'scripts', 'data', 'portrait-sync-report.json');
const MINIMUM_SOURCE_BYTES = 1024;
const MAXIMUM_SOURCE_BYTES = 25 * 1024 * 1024;
const DOWNLOAD_ATTEMPTS = 3;
const BASE_PORTRAIT_FIELDS = Object.freeze(['干员ID', '名称', '启用', '立绘URL', '立绘附件']);

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function cell(fields, name) {
  return unwrapCellValue(fields[name]);
}

export function safeOperatorFilename(operatorId, extension = 'webp') {
  const id = String(operatorId ?? '').trim();
  if (!id) throw new Error('干员 ID 不能为空');
  const encoded = /^[A-Za-z0-9._~-]+$/.test(id)
    ? id
    : `id-${Buffer.from(id, 'utf8').toString('base64url')}`;
  if (!/^[A-Za-z0-9._~-]+$/.test(encoded)) throw new Error(`干员 ID 无法安全映射为文件名: ${id}`);
  if (!['webp', 'png', 'jpg', 'jpeg'].includes(extension)) throw new Error(`不支持的立绘扩展名: ${extension}`);
  return `${encoded}.${extension}`;
}

export function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return undefined;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { format: 'png', contentType: 'image/png' };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { format: 'jpeg', contentType: 'image/jpeg' };
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { format: 'webp', contentType: 'image/webp' };
  }
  return undefined;
}

export function imageDimensions(buffer, format = detectImageType(buffer)?.format) {
  if (format === 'png' && buffer.length >= 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (format === 'webp' && buffer.length >= 30) {
    const chunk = buffer.subarray(12, 16).toString('ascii');
    if (chunk === 'VP8X') {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
      };
    }
    if (chunk === 'VP8 ' && buffer.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
      };
    }
    if (chunk === 'VP8L' && buffer[20] === 0x2f) {
      return {
        width: 1 + buffer[21] + ((buffer[22] & 0x3f) << 8),
        height: 1 + (buffer[22] >> 6) + (buffer[23] << 2) + ((buffer[24] & 0x0f) << 10),
      };
    }
  }
  if (format === 'jpeg') {
    let offset = 2;
    const startOfFrameMarkers = new Set([
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
    ]);
    while (offset + 8 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > buffer.length) return undefined;
      if (startOfFrameMarkers.has(marker) && length >= 7) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
  }
  return undefined;
}

export function extractAttachmentFiles(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const fileToken = item.file_token ?? item.fileToken ?? item.token;
    if (typeof fileToken !== 'string' || !fileToken.trim()) return [];
    return [{
      fileToken: fileToken.trim(),
      name: String(item.name ?? item.file_name ?? item.fileName ?? '').trim(),
      size: Number(item.size ?? 0) || undefined,
    }];
  });
}

export function selectPortraitSource(record) {
  const fields = recordFields(record);
  const attachments = extractAttachmentFiles(fields['立绘附件']);
  if (attachments.length > 1) {
    throw new Error(`干员 ${cell(fields, '干员ID')} 的“立绘附件”有 ${attachments.length} 个文件；每名干员只能保留一个`);
  }
  if (attachments.length === 1) {
    const attachment = attachments[0];
    return {
      kind: 'base-attachment',
      fileToken: attachment.fileToken,
      sourceFingerprint: sha256(`base-attachment\0${attachment.fileToken}`),
      sourceUrl: null,
    };
  }
  const sourceUrl = String(unwrapUrlCellValue(fields['立绘URL']) ?? '').trim();
  if (!/^https:\/\//.test(sourceUrl)) {
    throw new Error(`干员 ${cell(fields, '干员ID')} 既没有立绘附件，也没有有效 HTTPS 立绘URL`);
  }
  return {
    kind: 'portrait-url',
    sourceFingerprint: sha256(`portrait-url\0${sourceUrl}`),
    sourceUrl,
  };
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function replaceFileSafely(targetPath, contents) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const temporaryPath = `${targetPath}.${suffix}.tmp`;
  const backupPath = `${targetPath}.${suffix}.bak`;
  await writeFile(temporaryPath, contents, { flag: 'wx' });
  let movedExisting = false;
  try {
    if (existsSync(targetPath)) {
      await rename(targetPath, backupPath);
      movedExisting = true;
    }
    await rename(temporaryPath, targetPath);
    if (movedExisting) await rm(backupPath, { force: true });
  } catch (error) {
    await rm(temporaryPath, { force: true });
    if (movedExisting && !existsSync(targetPath) && existsSync(backupPath)) {
      await rename(backupPath, targetPath);
    }
    throw error;
  }
}

async function validateImage(buffer, declaredContentType, label) {
  if (!Buffer.isBuffer(buffer) || buffer.length < MINIMUM_SOURCE_BYTES) {
    throw new Error(`${label} 文件过小（${buffer?.length ?? 0} bytes）`);
  }
  if (buffer.length > MAXIMUM_SOURCE_BYTES) {
    throw new Error(`${label} 文件超过 25 MiB 安全上限`);
  }
  const detected = detectImageType(buffer);
  if (!detected) throw new Error(`${label} 魔数不是 WebP / PNG / JPEG`);
  if (declaredContentType && !String(declaredContentType).toLowerCase().startsWith('image/')) {
    throw new Error(`${label} Content-Type 不是图片: ${declaredContentType}`);
  }

  const dimensions = imageDimensions(buffer, detected.format);
  if (!dimensions || dimensions.width < 100 || dimensions.height < 100) {
    throw new Error(`${label} 无法解析合法图片尺寸`);
  }
  if (dimensions.width * dimensions.height > 100_000_000) {
    throw new Error(`${label} 像素总数超过 1 亿安全上限`);
  }
  return {
    output: buffer,
    format: detected.format,
    width: dimensions.width,
    height: dimensions.height,
    sourceContentType: detected.contentType,
  };
}

async function validateExisting(item, targetPath) {
  if (!item || !existsSync(targetPath)) return undefined;
  const buffer = await readFile(targetPath);
  if (buffer.length !== item.bytes || sha256(buffer) !== item.sha256) return undefined;
  const validated = await validateImage(buffer, item.contentType, `已有立绘 ${item.operatorId}`);
  if (validated.format !== item.format) return undefined;
  return validated;
}

async function fetchWithRetry(url) {
  let lastError;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8',
          'User-Agent': 'Arknights-random portrait sync/1.0 (+https://github.com/huachen19867/Arknights-random)',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_SOURCE_BYTES) {
        throw new Error(`Content-Length 超过 25 MiB: ${declaredLength}`);
      }
      return {
        buffer: Buffer.from(await response.arrayBuffer()),
        contentType: response.headers.get('content-type')?.split(';')[0]?.trim(),
      };
    } catch (error) {
      lastError = error;
      if (attempt < DOWNLOAD_ATTEMPTS) await sleep(500 * (2 ** (attempt - 1)));
    }
  }
  throw new Error(`下载失败（重试 ${DOWNLOAD_ATTEMPTS} 次）: ${lastError?.message ?? lastError}`);
}

async function downloadSource(source, record, temporaryDirectory, baseOptions) {
  if (source.kind === 'portrait-url') return fetchWithRetry(source.sourceUrl);
  const temporaryPath = path.join(temporaryDirectory, `${recordId(record)}.download`);
  await downloadRecordAttachment({
    ...baseOptions,
    recordId: recordId(record),
    fileToken: source.fileToken,
    output: temporaryPath,
  });
  const fileInfo = await stat(temporaryPath);
  if (!fileInfo.isFile()) throw new Error('飞书附件命令没有生成普通文件');
  return { buffer: await readFile(temporaryPath), contentType: undefined };
}

function buildRecordMap(records) {
  const result = new Map();
  for (const record of records) {
    const fields = recordFields(record);
    if (cell(fields, '启用') !== true) continue;
    const id = String(cell(fields, '干员ID') ?? '').trim();
    const name = String(cell(fields, '名称') ?? '').trim();
    if (!id || !name) throw new Error(`Base 启用记录缺少干员ID或名称: ${recordId(record)}`);
    if (result.has(id)) throw new Error(`Base 启用干员 ID 重复: ${id}`);
    result.set(id, { record, name });
  }
  return result;
}

function createReport({ startedAt, dataset, recordsById, previousManifest }) {
  const activeIds = new Set(dataset.operators.map((operator) => operator.id));
  const previousItems = Array.isArray(previousManifest?.items) ? previousManifest.items : [];
  return {
    schemaVersion: 1,
    startedAt,
    completedAt: null,
    ok: false,
    expectedCount: dataset.operators.length,
    baseEnabledCount: recordsById.size,
    reusedCount: 0,
    downloadedCount: 0,
    attachmentCount: 0,
    urlCount: 0,
    failures: [],
    missingFromBase: dataset.operators.filter((operator) => !recordsById.has(operator.id)).map(({ id, name }) => ({ id, name })),
    unexpectedInBase: [...recordsById.entries()].filter(([id]) => !activeIds.has(id)).map(([id, value]) => ({ id, name: value.name })),
    retainedRemovedAssets: previousItems
      .filter((item) => !activeIds.has(item.operatorId))
      .map((item) => ({ operatorId: item.operatorId, name: item.name, path: item.path })),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/sync-portraits.mjs [--input public/data/operators.json] [--force]');
    console.log('Env: LARK_BASE_TOKEN, LARK_TABLE_ID, optional LARK_AS=user');
    return;
  }
  const baseToken = requiredEnvironment('LARK_BASE_TOKEN');
  const tableId = requiredEnvironment('LARK_TABLE_ID');
  const identity = process.env.LARK_AS?.trim() || 'user';
  const input = path.resolve(args.input ?? DEFAULT_INPUT);
  const outputDirectory = path.resolve(args['output-dir'] ?? DEFAULT_OUTPUT_DIRECTORY);
  const manifestPath = path.resolve(args.manifest ?? DEFAULT_MANIFEST);
  const reportPath = path.resolve(args.report ?? DEFAULT_REPORT);
  const force = args.force === true;
  const startedAt = new Date().toISOString();
  const temporaryDirectory = path.join(PROJECT_ROOT, 'scripts', '.tmp', `portraits-${process.pid}`);
  await mkdir(temporaryDirectory, { recursive: true });

  let report;
  try {
    console.log('[1/4] 串行分页读取飞书 Base 立绘字段');
    const records = await listAllRecords({
      baseToken,
      tableId,
      fields: BASE_PORTRAIT_FIELDS,
      identity,
    });
    const dataset = await readDataset(input);
    const recordsById = buildRecordMap(records);
    const previousManifest = await readJsonIfExists(manifestPath);
    const previousItems = new Map(
      (Array.isArray(previousManifest?.items) ? previousManifest.items : []).map((item) => [item.operatorId, item]),
    );
    report = createReport({ startedAt, dataset, recordsById, previousManifest });
    if (report.missingFromBase.length > 0 || report.unexpectedInBase.length > 0) {
      throw new Error(`Base 与快照启用 ID 不一致：快照缺失 ${report.missingFromBase.length}，Base 多出 ${report.unexpectedInBase.length}`);
    }

    console.log(`[2/4] 同步 ${dataset.operators.length} 张立绘（附件优先，URL 兜底）`);
    const manifestItems = [];
    for (const [index, operator] of dataset.operators.entries()) {
      const entry = recordsById.get(operator.id);
      const source = selectPortraitSource(entry.record);
      const previous = previousItems.get(operator.id);
      const expectedPreviousFilename = previous?.format
        ? safeOperatorFilename(operator.id, previous.format)
        : undefined;
      const mayReuse = !force
        && previous?.sourceFingerprint === source.sourceFingerprint
        && path.basename(previous.path ?? '') === expectedPreviousFilename;
      let validated;
      let filename;
      let relativePath;
      let targetPath;
      let syncedAt = startedAt;
      if (mayReuse) {
        filename = path.basename(previous.path);
        relativePath = `assets/operators/${filename}`;
        targetPath = path.join(outputDirectory, filename);
        const existing = await validateExisting(previous, targetPath);
        if (existing) {
          validated = {
            ...existing,
            sourceContentType: previous.sourceContentType ?? existing.sourceContentType,
          };
          syncedAt = previous.syncedAt;
          report.reusedCount += 1;
        }
      }
      try {
        if (!validated) {
          const downloaded = await downloadSource(source, entry.record, temporaryDirectory, {
            baseToken,
            tableId,
            identity,
          });
          validated = await validateImage(downloaded.buffer, downloaded.contentType, `${operator.id} ${operator.name}`);
          filename = safeOperatorFilename(operator.id, validated.format);
          relativePath = `assets/operators/${filename}`;
          targetPath = path.join(outputDirectory, filename);
          await replaceFileSafely(targetPath, validated.output);
          report.downloadedCount += 1;
        }
        if (source.kind === 'base-attachment') report.attachmentCount += 1;
        else report.urlCount += 1;
        manifestItems.push({
          operatorId: operator.id,
          name: operator.name,
          path: relativePath,
          source: source.kind,
          sourceUrl: source.sourceUrl,
          sourceFingerprint: source.sourceFingerprint,
          sha256: sha256(validated.output),
          bytes: validated.output.length,
          format: validated.format,
          width: validated.width,
          height: validated.height,
          contentType: validated.sourceContentType,
          sourceContentType: validated.sourceContentType,
          syncedAt,
        });
      } catch (error) {
        report.failures.push({ operatorId: operator.id, name: operator.name, message: error?.message ?? String(error) });
      }
      if ((index + 1) % 25 === 0 || index + 1 === dataset.operators.length) {
        console.log(`    ${index + 1}/${dataset.operators.length}，复用 ${report.reusedCount}，下载 ${report.downloadedCount}，失败 ${report.failures.length}`);
      }
    }

    if (report.failures.length > 0) {
      throw new Error(`${report.failures.length} 张立绘同步失败；未改写快照或清单，已有文件均保留`);
    }
    if (manifestItems.length !== dataset.operators.length) throw new Error('立绘清单数量与快照不一致');

    console.log('[3/4] 校验本地路径并原子改写网页快照');
    const activeFilenames = new Set(manifestItems.map((item) => path.basename(item.path)));
    const staleAssets = [];
    for (const entry of await readdir(outputDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name === path.basename(manifestPath) || entry.name.endsWith('.stale')) continue;
      if (!/\.(?:webp|png|jpe?g)$/i.test(entry.name) || activeFilenames.has(entry.name)) continue;
      const previousPath = path.join(outputDirectory, entry.name);
      const stalePath = `${previousPath}.stale`;
      await rm(stalePath, { force: true });
      await rename(previousPath, stalePath);
      staleAssets.push({ from: entry.name, to: path.basename(stalePath) });
    }
    report.quarantinedStaleAssets = staleAssets;
    const pathById = new Map(manifestItems.map((item) => [item.operatorId, item.path]));
    const localOperators = dataset.operators.map((operator) => ({
      ...operator,
      portrait: pathById.get(operator.id),
    }));
    const localDataset = createDataset(localOperators, {
      generatedAt: dataset.generatedAt ?? startedAt,
      source: dataset.source,
    });
    const validation = validateDataset(localDataset, { minimumCount: dataset.operators.length });
    if (!validation.ok) throw new Error(`本地立绘快照校验失败:\n- ${validation.errors.join('\n- ')}`);

    await writeJsonAtomic(manifestPath, {
      schemaVersion: 1,
      generatedAt: startedAt,
      count: manifestItems.length,
      items: manifestItems,
    });
    await writeJsonAtomic(input, localDataset);
    report.ok = true;
    report.completedAt = new Date().toISOString();
    await writeJsonAtomic(reportPath, report);
    console.log(`[4/4] 发布完成：${manifestItems.length} 张，附件 ${report.attachmentCount}，URL ${report.urlCount}`);
  } catch (error) {
    if (report) {
      report.completedAt = new Date().toISOString();
      report.fatalError = error?.message ?? String(error);
      await writeJsonAtomic(reportPath, report);
    }
    throw error;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[fatal] ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
