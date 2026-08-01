import crypto from 'node:crypto';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createDataset,
  diffOperatorVersions,
  parseArgs,
  parsePrtsModules,
  parsePrtsOperators,
  parsePrtsSkills,
  readDataset,
  reconcileStableOperatorIds,
  validateDataset,
  validateVersionTransition,
  writeJsonAtomic,
} from './lib/operators.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

function readPortraitExceptions() {
  const exceptionPath = path.resolve(SCRIPT_DIRECTORY, '..', 'config', 'portrait-exceptions.json');
  try {
    const value = JSON.parse(readFileSync(exceptionPath, 'utf8').replace(/^\uFEFF/, ''));
    for (const [name, item] of Object.entries(value)) {
      if (!item || (item.fallback !== 'elite2' && item.fallback !== 'avatar')) {
        throw new Error(`例外表 ${name} 的 fallback 只能是 elite2 或 avatar`);
      }
    }
    return value;
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}
const DEFAULT_OUTPUT = path.join(SCRIPT_DIRECTORY, 'data', 'prts-operators.json');
const DEFAULT_DIFF_OUTPUT = path.join(SCRIPT_DIRECTORY, 'data', 'prts-diff.json');
const LIST_URL = 'https://m.prts.wiki/w/%E5%B9%B2%E5%91%98%E4%B8%80%E8%A7%88';
const MEDIA_ORIGIN = 'https://media.prts.wiki';
const USER_AGENT = 'ArknightsRandomTool/1.0 (reproducible operator data sync; PRTS source)';

function mediaPath(filename) {
  const normalized = filename.normalize('NFC').replaceAll(' ', '_');
  const hash = crypto.createHash('md5').update(normalized, 'utf8').digest('hex');
  return `${hash[0]}/${hash.slice(0, 2)}/${encodeURIComponent(normalized)}`;
}

function createPortraitUrl(name, phase, width, quality) {
  const filename = `立绘_${name}_${phase}.png`;
  const media = mediaPath(filename);
  const encoded = media.slice(media.lastIndexOf('/') + 1);
  return `${MEDIA_ORIGIN}/thumb/${media}/${width}px-${encoded}?image_process=format,webp/quality,Q_${quality}`;
}

export function portraitCandidates(name, width = 800, quality = 80) {
  const avatarFilename = `头像_${name}.png`;
  return [
    { kind: 'elite0', url: createPortraitUrl(name, 1, width, quality) },
    { kind: 'avatar', url: `${MEDIA_ORIGIN}/${mediaPath(avatarFilename)}` },
  ];
}

export function portraitOriginalUrl(name) {
  const filename = `立绘_${name}_1.png`;
  const media = mediaPath(filename);
  return `${MEDIA_ORIGIN}/${media}`;
}

export function portraitElite2Url(name, width = 800, quality = 80) {
  return createPortraitUrl(name, 2, width, quality);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchWithRetry(url, options = {}) {
  const retries = Number(options.retries ?? 2);
  const timeout = Number(options.timeout ?? 15_000);
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        method: options.method ?? 'GET',
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT, ...(options.headers ?? {}) },
        signal: controller.signal,
      });
      if (response.status >= 500 || response.status === 429) {
        lastError = new Error(`HTTP ${response.status}: ${url}`);
        if (attempt < retries) {
          await response.body?.cancel();
          await wait(400 * (2 ** attempt));
          continue;
        }
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await wait(400 * (2 ** attempt));
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error(`请求失败: ${url}`);
}

async function isImageAvailable(url, options) {
  const response = await fetchWithRetry(url, { ...options, method: 'HEAD' });
  const type = response.headers.get('content-type') ?? '';
  await response.body?.cancel();
  return response.ok && type.toLowerCase().startsWith('image/');
}

async function resolvePortrait(operator, options, exception) {
  const [elite0, avatar] = portraitCandidates(operator.name, options.width, options.quality);
  try {
    if (await isImageAvailable(elite0.url, options)) return elite0;
  } catch (error) {
    process.stderr.write(`\n[warning] ${operator.name} elite0 800px: ${error.message}\n`);
  }
  const originalUrl = portraitOriginalUrl(operator.name);
  try {
    if (await isImageAvailable(originalUrl, options)) return { kind: 'elite0', url: originalUrl };
  } catch (error) {
    process.stderr.write(`\n[warning] ${operator.name} elite0 原图: ${error.message}\n`);
  }
  if (exception?.fallback === 'elite2') {
    const elite2Url = portraitElite2Url(operator.name, options.width, options.quality);
    try {
      if (await isImageAvailable(elite2Url, options)) return { kind: 'elite2', url: elite2Url };
    } catch (error) {
      process.stderr.write(`\n[warning] ${operator.name} elite2 例外: ${error.message}\n`);
    }
  }
  let avatarAvailable = false;
  try {
    avatarAvailable = await isImageAvailable(avatar.url, options);
  } catch {
    avatarAvailable = false;
  }
  throw new Error(
    `${operator.name} (${operator.id}) 的精零立绘不可用${avatarAvailable ? '（头像可用，需人工确认例外后再处理）' : '（头像也不可用）'}`,
  );
}

async function fetchOperatorDetails(operator, options) {
  const detailUrl = `https://m.prts.wiki/w/${encodeURIComponent(operator.name.replaceAll(' ', '_'))}`;
  const response = await fetchWithRetry(detailUrl, options);
  if (!response.ok) throw new Error(`${operator.name} 详情页返回 HTTP ${response.status}`);
  const html = await response.text();
  try {
    return {
      skills: parsePrtsSkills(html),
      modules: parsePrtsModules(html),
    };
  } catch (error) {
    throw new Error(`${operator.name} (${operator.id}) 解析详情页失败: ${error.message}`);
  }
}

async function readPreviousDataset(output) {
  try {
    return await readDataset(output);
  } catch (error) {
    if (error?.code === 'ENOENT') return createDataset([], { source: { kind: 'none' } });
    throw error;
  }
}

async function mapConcurrent(items, concurrency, mapper) {
  const result = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      result[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/sync-prts.mjs [--output <json>] [--diff-output <json>] [--concurrency 4]');
    console.log('       [--allow-removals] [--max-additions 50] [--max-changes 50]');
    console.log('       [--recheck-portraits] [--recheck-skills] [--recheck-modules] [--migrate-portraits-elite0]');
    return;
  }
  const output = path.resolve(args.output ?? DEFAULT_OUTPUT);
  const diffOutput = path.resolve(args['diff-output'] ?? DEFAULT_DIFF_OUTPUT);
  const concurrency = Number(args.concurrency ?? 4);
  const width = Number(args.width ?? 800);
  const quality = Number(args.quality ?? 80);
  const timeout = Number(args.timeout ?? 15_000);
  const retries = Number(args.retries ?? 2);
  const minimumCount = Number(args['minimum-count'] ?? 350);
  const maximumAdditions = Number(args['max-additions'] ?? 50);
  const maximumChanges = Number(args['max-changes'] ?? 50);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error('--concurrency 必须是 1-8 的整数');
  }
  if (!Number.isInteger(maximumAdditions) || maximumAdditions < 0) throw new Error('--max-additions 必须是非负整数');
  if (!Number.isInteger(maximumChanges) || maximumChanges < 0) throw new Error('--max-changes 必须是非负整数');
  const migrationMode = Boolean(args['migrate-portraits-elite0']);

  const portraitExceptions = readPortraitExceptions();
  const previousDataset = await readPreviousDataset(output);
  const previousById = new Map(previousDataset.operators.map((operator) => [operator.id, operator]));
  console.log(`[1/4] 读取 PRTS 干员一览: ${LIST_URL}`);
  const page = await fetchWithRetry(LIST_URL, { timeout, retries });
  if (!page.ok) throw new Error(`PRTS 干员一览返回 HTTP ${page.status}`);
  const html = await page.text();
  const baseOperators = reconcileStableOperatorIds(parsePrtsOperators(html), previousDataset.operators);
  const portraitExceptionIds = new Set(
    baseOperators.filter((operator) => portraitExceptions[operator.name]).map((operator) => operator.id),
  );
  console.log(`[2/4] 解析到 ${baseOperators.length} 名干员；抓取详情技能/模组并按需执行 HEAD 精零立绘校验`);

  const generatedAt = new Date().toISOString();
  let completed = 0;
  let reusedPortraits = 0;
  let checkedPortraits = 0;
  let reusedSkills = 0;
  let fetchedSkills = 0;
  let reusedModules = 0;
  let fetchedModules = 0;
  const enrichedOperators = await mapConcurrent(baseOperators, concurrency, async (operator) => {
    const previous = previousById.get(operator.id);
    const expectedElite0 = portraitCandidates(operator.name, width, quality)[0];
    const canReusePortrait = !args['recheck-portraits']
      && previous?.portraitKind === 'elite0'
      && previous.portrait === expectedElite0.url;
    const portraitPromise = canReusePortrait
      ? Promise.resolve(expectedElite0)
      : resolvePortrait(operator, { width, quality, timeout, retries }, portraitExceptions[operator.name]);
    if (canReusePortrait) reusedPortraits += 1;
    else checkedPortraits += 1;
    const sameIdentity = previous?.name === operator.name
      && previous?.rarity === operator.rarity
      && previous?.profession === operator.profession;
    const canReuseSkills = !args['recheck-skills']
      && sameIdentity
      && Array.isArray(previous?.skills);
    const canReuseModules = !args['recheck-modules']
      && sameIdentity
      && Array.isArray(previous?.modules);
    let skillsPromise;
    let modulesPromise;
    if (canReuseSkills && canReuseModules) {
      skillsPromise = Promise.resolve(previous.skills);
      modulesPromise = Promise.resolve(previous.modules);
      reusedSkills += 1;
      reusedModules += 1;
    } else if (canReuseSkills) {
      skillsPromise = Promise.resolve(previous.skills);
      modulesPromise = fetchOperatorDetails(operator, { timeout, retries }).then((details) => details.modules);
      reusedSkills += 1;
      fetchedModules += 1;
    } else if (canReuseModules) {
      modulesPromise = Promise.resolve(previous.modules);
      skillsPromise = fetchOperatorDetails(operator, { timeout, retries }).then((details) => details.skills);
      reusedModules += 1;
      fetchedSkills += 1;
    } else {
      const detailsPromise = fetchOperatorDetails(operator, { timeout, retries });
      skillsPromise = detailsPromise.then((details) => details.skills);
      modulesPromise = detailsPromise.then((details) => details.modules);
      fetchedSkills += 1;
      fetchedModules += 1;
    }
    const [portrait, skills, parsedModules] = await Promise.all([
      portraitPromise,
      skillsPromise,
      modulesPromise,
    ]);
    if (
      args['recheck-modules']
      && Array.isArray(previous?.modules)
      && previous.modules.length > 0
      && parsedModules.length === 0
    ) {
      throw new Error(`${operator.name} (${operator.id}) 上次有 ${previous.modules.length} 个模组，本次解析为 0，疑似 PRTS 页面漂移`);
    }
    completed += 1;
    if (completed % 25 === 0 || completed === baseOperators.length) {
      process.stdout.write(`\r    详情与立绘 ${completed}/${baseOperators.length}`);
      if (completed === baseOperators.length) process.stdout.write('\n');
    }
    return {
      ...operator,
      enabled: true,
      portrait: portrait.url,
      portraitKind: portrait.kind,
      sourceUrl: `https://prts.wiki/w/${encodeURIComponent(operator.name.replaceAll(' ', '_'))}`,
      skills,
      modules: parsedModules.map((module) => ({
        id: `${operator.id}:${module.code}`,
        index: module.index,
        name: module.name,
        code: module.code,
        sourceUrl: `https://prts.wiki/w/${encodeURIComponent(operator.name.replaceAll(' ', '_'))}#模组`,
      })),
      updatedAt: generatedAt,
    };
  });

  const preliminaryDiff = diffOperatorVersions(previousDataset.operators, enrichedOperators);
  const changedIds = new Set([
    ...preliminaryDiff.additions.map((item) => item.id),
    ...preliminaryDiff.changes.map((item) => item.id),
  ]);
  const operators = enrichedOperators.map((operator) => ({
    ...operator,
    updatedAt: changedIds.has(operator.id)
      ? generatedAt
      : previousById.get(operator.id)?.updatedAt ?? generatedAt,
  }));
  operators.sort((left, right) => left.id.localeCompare(right.id, 'en'));
  const dataset = createDataset(operators, {
    generatedAt,
    source: { kind: 'prts', url: LIST_URL },
  });
  const report = validateDataset(dataset, {
    minimumCount,
    strictPortraitKinds: ['elite2'],
    portraitKindExceptions: portraitExceptionIds,
  });
  const diff = diffOperatorVersions(previousDataset.operators, operators);
  if (migrationMode) {
    const allowedMigrationFields = new Set(['portrait', 'portraitKind', 'modules']);
    const nonPortraitChanges = diff.changes.filter((change) => (
      change.fields.some(({ field }) => !allowedMigrationFields.has(field))
    ));
    if (nonPortraitChanges.length > 0) {
      throw new Error(`精零迁移只允许 portrait/portraitKind/modules 变化（首次模组采集），发现其他字段变化:\n- ${nonPortraitChanges
        .map((change) => `${change.id} ${change.name}: ${change.fields.map((field) => field.field).join(',')}`)
        .join('\n- ')}`);
    }
  }
  const migratedPortraitCount = migrationMode
    ? diff.changes.filter((change) => (
        change.fields.some(({ field, before }) => field === 'portraitKind' && before !== 'elite0')
      )).length
    : 0;
  const transitionErrors = validateVersionTransition(diff, {
    allowRemovals: Boolean(args['allow-removals']),
    maximumAdditions,
    maximumChanges: migrationMode ? Number.POSITIVE_INFINITY : maximumChanges,
  });
  const diffReport = {
    generatedAt,
    output: path.relative(process.cwd(), output).split(path.sep).join('/') || path.basename(output),
    options: {
      allowRemovals: Boolean(args['allow-removals']),
      maximumAdditions,
      maximumChanges,
      recheckPortraits: Boolean(args['recheck-portraits']),
      recheckSkills: Boolean(args['recheck-skills']),
      recheckModules: Boolean(args['recheck-modules']),
      migratePortraitsElite0: migrationMode,
    },
    portraitResolution: { reused: reusedPortraits, checked: checkedPortraits },
    skillResolution: { reused: reusedSkills, fetched: fetchedSkills },
    moduleResolution: { reused: reusedModules, fetched: fetchedModules },
    migratedPortraitCount,
    portraitExceptions: Object.fromEntries(
      Object.entries(portraitExceptions).map(([name, item]) => [name, item]),
    ),
    validation: report,
    transitionErrors,
    ...diff,
  };
  await writeJsonAtomic(diffOutput, diffReport);
  console.log(`[3/4] 差异报告: ${diffOutput}`);
  if (!report.ok) throw new Error(`数据校验失败:\n- ${report.errors.join('\n- ')}`);
  if (transitionErrors.length > 0) throw new Error(`版本迁移保护拒绝覆盖旧数据:\n- ${transitionErrors.join('\n- ')}`);
  await writeJsonAtomic(output, dataset);
  console.log(`[4/4] 已安全写入 ${output}；复用精零 ${reusedPortraits}，检查立绘 ${checkedPortraits}；复用技能 ${reusedSkills}，抓取技能 ${fetchedSkills}；复用模组 ${reusedModules}，抓取模组 ${fetchedModules}${migrationMode ? `；精零迁移 ${migratedPortraitCount} 名` : ''}`);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[fatal] ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
