import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Pinned snapshots: updating either value is an explicit asset migration.
export const ASSET_COMMIT = 'b6baa8f81f473a9c27b12e1ebe6a0546c3258ee7';
export const PORTRAIT_TREE = '0e21ba138be4984144027311ae06564a5be4087f';
export const GAME_DATA_COMMIT = 'a550f5e048bb94e7cdefc6eb97a4091f0c4c7add';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OPERATOR_PATH = path.join(ROOT, 'public/data/operators.json');
const OUTPUT_DIR = path.join(ROOT, 'public/assets/squad-portraits');
const MANIFEST_PATH = path.join(ROOT, 'public/data/squad-portraits.json');
const REPORT_PATH = path.join(ROOT, 'scripts/data/squad-portrait-report.json');
const ASSET_ROOT = 'assets/dyn/arts/charportraits';
const RAW_ASSETS = `https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/${ASSET_COMMIT}/${ASSET_ROOT}`;
const GAME_TABLE_URL = `https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/${GAME_DATA_COMMIT}/zh_CN/gamedata/excel/character_table.json`;
const PATCH_TABLE_URL = `https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/${GAME_DATA_COMMIT}/zh_CN/gamedata/excel/char_patch_table.json`;
const TREE_URL = `https://api.github.com/repos/ArknightsAssets/ArknightsAssets2/git/trees/${PORTRAIT_TREE}`;
const EXPECTED_SIZE_LIMIT = 4 * 1024 * 1024;
const execFileAsync = promisify(execFile);

function hash(algorithm, data) { return createHash(algorithm).update(data).digest('hex'); }
function imageFilename(id) {
  const safe = /^[A-Za-z0-9._~-]+$/.test(id) ? id : `id-${Buffer.from(id).toString('base64url')}`;
  return `${safe}.png`;
}
function gitBlobSha(buffer) {
  return hash('sha1', Buffer.concat([Buffer.from(`blob ${buffer.length}\0`), buffer]));
}
export function inspectPng(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 45 || !buffer.subarray(0, 8).equals(signature)) throw new Error('PNG 魔数无效');
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') throw new Error('PNG 缺少 IHDR');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width < 100 || height < 100 || width > 8192 || height > 8192) {
    throw new Error(`PNG 尺寸异常: ${width}×${height}`);
  }
  if (buffer.length > EXPECTED_SIZE_LIMIT) throw new Error(`PNG 超过 ${EXPECTED_SIZE_LIMIT} bytes`);
  return { width, height, bytes: buffer.length, sha256: hash('sha256', buffer) };
}

async function fetchBuffer(url, { retries = 4 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Arknights-random squad portrait sync', Accept: 'application/json,image/png,*/*' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt + 1 < retries) await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)));
    }
  }
  throw new Error(`${url}: ${lastError?.message ?? lastError}`);
}
async function fetchGithubJson(apiPath, fallbackUrl) {
  try {
    const { stdout } = await execFileAsync('gh', ['api', '-H', 'Accept: application/vnd.github.raw+json', apiPath],
      { maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' });
    return JSON.parse(stdout);
  } catch (error) {
    // GitHub CLI is optional; public pinned URLs are a slower but reproducible fallback.
    if (error.code !== 'ENOENT') console.warn(`gh api 读取失败，改用公开 URL：${error.message.split('\n')[0]}`);
    return JSON.parse((await fetchBuffer(fallbackUrl)).toString('utf8'));
  }
}
async function fetchAssetBuffer(sourceFile, expectedGitSha) {
  const apiPath = `repos/ArknightsAssets/ArknightsAssets2/contents/${ASSET_ROOT}/${encodeURIComponent(sourceFile)}?ref=${ASSET_COMMIT}`;
  try {
    const { stdout } = await execFileAsync('gh', ['api', apiPath],
      { maxBuffer: EXPECTED_SIZE_LIMIT * 2, encoding: 'utf8' });
    const payload = JSON.parse(stdout);
    if (payload.encoding !== 'base64' || payload.sha !== expectedGitSha || !payload.content) {
      throw new Error('GitHub Contents 响应缺少匹配的 base64 blob');
    }
    return Buffer.from(payload.content.replace(/\s/g, ''), 'base64');
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`gh api 图片读取失败，改用公开 URL：${sourceFile}: ${error.message.split('\n')[0]}`);
    return fetchBuffer(`${RAW_ASSETS}/${encodeURIComponent(sourceFile)}`);
  }
}
async function writeAtomic(target, data) {
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temp, data, { flag: 'wx' });
    await rename(temp, target);
  } finally {
    await rm(temp, { force: true });
  }
}
async function readJsonIfExists(target) {
  try { return JSON.parse(await readFile(target, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}
function recordsFromGameTable(table) {
  if (Array.isArray(table?.characters)) {
    return table.characters.map(({ key, value }) => [key, value]);
  }
  if (table?.characters && typeof table.characters === 'object') return Object.entries(table.characters);
  return Object.entries(table);
}
function normalizeName(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase();
}
const PROFESSION_CODES = {
  先锋: 'PIONEER', 近卫: 'WARRIOR', 重装: 'TANK', 狙击: 'SNIPER',
  术师: 'CASTER', 医疗: 'MEDIC', 辅助: 'SUPPORT', 特种: 'SPECIAL',
};
export function selectGameCharacter(operator, records, portraitNames) {
  const formName = normalizeName(operator.name);
  const plainName = formName.replace(/\((?:医疗|近卫|术师)\)$/, '');
  const candidates = records.filter(([charId, character]) =>
    charId.startsWith('char_') && normalizeName(character?.name) === plainName && character?.isNotObtainable !== true);
  const withPortrait = candidates.filter(([charId]) => portraitNames.has(`${charId}_1.png`) || portraitNames.has(`${charId}_2.png`));
  if (withPortrait.length === 0) return { reason: 'game-character-or-portrait-missing', candidates: candidates.map(([id]) => id) };
  const profession = PROFESSION_CODES[operator.profession];
  const professionMatches = withPortrait.filter(([, character]) => character?.profession === profession);
  if (professionMatches.length === 0) return { reason: 'profession-mismatch', candidates: withPortrait.map(([id]) => id) };
  const professionNarrowed = professionMatches;
  const displayNumberMatches = professionNarrowed.filter(([, character]) => character?.displayNumber === operator.id.split(':')[0]);
  const narrowed = displayNumberMatches.length ? displayNumberMatches : professionNarrowed;
  if (narrowed.length !== 1) return { reason: 'ambiguous-character', candidates: narrowed.map(([id]) => id) };
  return { charId: narrowed[0][0], supportsElite2: narrowed[0][1]?.phases?.length >= 3 };
}
export function selectPortraitSource(charId, portraitFiles, supportsElite2) {
  const elite2 = supportsElite2 ? portraitFiles.get(`${charId}_2.png`) : undefined;
  const base = portraitFiles.get(`${charId}_1.png`);
  const file = elite2 ?? base;
  if (!file) return undefined;
  return { sourceFile: file.path, gitSha: file.sha, kind: elite2 ? 'elite2' : 'base' };
}

export async function verifySquadPortraits({ operatorPath = OPERATOR_PATH, manifestPath = MANIFEST_PATH, outputDir = OUTPUT_DIR } = {}) {
  const operators = (await readJsonIfExists(operatorPath))?.operators;
  const manifest = await readJsonIfExists(manifestPath);
  if (!Array.isArray(operators) || !manifest || !Array.isArray(manifest.items)) throw new Error('缺少干员数据或编队头像清单');
  if (manifest.schemaVersion !== 1 || manifest.count !== operators.length || manifest.items.length !== operators.length) {
    throw new Error(`编队头像数量不一致：干员 ${operators.length}，清单 ${manifest.items.length}`);
  }
  const byId = new Map(manifest.items.map((item) => [item.operatorId, item]));
  if (byId.size !== manifest.items.length) throw new Error('编队头像清单存在重复 ID');
  for (const operator of operators) {
    const item = byId.get(operator.id);
    if (!item || item.name !== operator.name || manifest.portraits?.[operator.id] !== item.path) {
      throw new Error(`编队头像映射缺失或错位: ${operator.id} ${operator.name}`);
    }
    if (item.path !== `assets/squad-portraits/${imageFilename(operator.id)}`) throw new Error(`编队头像路径不安全: ${item.path}`);
    const buffer = await readFile(path.join(outputDir, imageFilename(operator.id)));
    const image = inspectPng(buffer);
    if (image.sha256 !== item.sha256 || image.width !== item.width || image.height !== item.height || image.bytes !== item.bytes) {
      throw new Error(`编队头像校验失败: ${operator.id} ${operator.name}`);
    }
    if (gitBlobSha(buffer) !== item.gitSha) throw new Error(`上游 Git blob SHA 不匹配: ${operator.id} ${operator.name}`);
  }
  return { count: operators.length, elite2: manifest.items.filter((item) => item.kind === 'elite2').length,
    base: manifest.items.filter((item) => item.kind === 'base').length };
}

async function runPool(items, concurrency, action) {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await action(items[index], index);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const verifyOnly = process.argv.includes('--verify');
  if (verifyOnly) {
    const result = await verifySquadPortraits();
    console.log(`编队头像离线校验通过：${result.count} 张，精二 ${result.elite2} 张，基础 ${result.base} 张`);
    return;
  }
  const startedAt = new Date().toISOString();
  const dataset = await readJsonIfExists(OPERATOR_PATH);
  const previous = await readJsonIfExists(MANIFEST_PATH);
  if (!Array.isArray(dataset?.operators)) throw new Error('public/data/operators.json 缺少 operators');
  console.log('读取固定版本的角色表和游戏编队头像目录…');
  const [characterTable, patchTable, tree] = await Promise.all([
    fetchGithubJson(`repos/Kengxxiao/ArknightsGameData/contents/zh_CN/gamedata/excel/character_table.json?ref=${GAME_DATA_COMMIT}`, GAME_TABLE_URL),
    fetchGithubJson(`repos/Kengxxiao/ArknightsGameData/contents/zh_CN/gamedata/excel/char_patch_table.json?ref=${GAME_DATA_COMMIT}`, PATCH_TABLE_URL),
    fetchGithubJson(`repos/ArknightsAssets/ArknightsAssets2/git/trees/${PORTRAIT_TREE}`, TREE_URL),
  ]);
  const records = [...recordsFromGameTable(characterTable), ...Object.entries(patchTable.patchChars ?? {})];
  if (tree.sha !== PORTRAIT_TREE || tree.truncated || !Array.isArray(tree.tree) || tree.tree.length < 1000) {
    throw new Error('上游游戏编队头像目录不完整或版本不匹配');
  }
  const portraitFiles = new Map(tree.tree.filter((file) => file.type === 'blob' && file.path.endsWith('.png')).map((file) => [file.path, file]));
  const names = new Set(portraitFiles.keys());
  const report = { startedAt, assetCommit: ASSET_COMMIT, gameDataCommit: GAME_DATA_COMMIT,
    total: dataset.operators.length, reused: 0, downloaded: 0, elite2: 0, base: 0, missing: [], failures: [] };
  const jobs = dataset.operators.map((operator) => {
    const selected = selectGameCharacter(operator, records, names);
    if (!selected.charId) {
      report.missing.push({ operatorId: operator.id, name: operator.name, ...selected });
      return undefined;
    }
    const source = selectPortraitSource(selected.charId, portraitFiles, selected.supportsElite2);
    if (!source) {
      report.missing.push({ operatorId: operator.id, name: operator.name, reason: 'portrait-missing', charId: selected.charId });
      return undefined;
    }
    return { operator, charId: selected.charId, ...source };
  }).filter(Boolean);
  const previousItems = new Map((previous?.items ?? []).map((item) => [item.operatorId, item]));
  const resultItems = new Array(jobs.length);
  await mkdir(OUTPUT_DIR, { recursive: true });
  await runPool(jobs, 6, async (job, index) => {
    const { operator } = job;
    const filename = imageFilename(operator.id);
    const target = path.join(OUTPUT_DIR, filename);
    const previousItem = previousItems.get(operator.id);
    try {
      let buffer;
      try {
        const existing = await readFile(target);
        const inspected = inspectPng(existing);
        if (gitBlobSha(existing) === job.gitSha && (!previousItem || inspected.sha256 === previousItem.sha256)) {
          buffer = existing;
          report.reused += 1;
        }
      } catch { /* Invalid or missing cache is downloaded again. */ }
      if (!buffer) {
        buffer = await fetchAssetBuffer(job.sourceFile, job.gitSha);
        inspectPng(buffer);
        if (gitBlobSha(buffer) !== job.gitSha) throw new Error(`Git blob SHA 不匹配: ${job.sourceFile}`);
        await writeAtomic(target, buffer);
        report.downloaded += 1;
      }
      const image = inspectPng(buffer);
      report[job.kind] += 1;
      resultItems[index] = { operatorId: operator.id, name: operator.name, charId: job.charId, kind: job.kind,
        path: `assets/squad-portraits/${filename}`, sourceFile: job.sourceFile, gitSha: job.gitSha,
        ...image };
    } catch (error) {
      report.failures.push({ operatorId: operator.id, name: operator.name, message: error?.message ?? String(error) });
    }
    const done = report.reused + report.downloaded + report.failures.length;
    if (done % 50 === 0 || done === jobs.length) console.log(`${done}/${jobs.length}，复用 ${report.reused}，下载 ${report.downloaded}，失败 ${report.failures.length}`);
  });
  report.completedAt = new Date().toISOString();
  await writeAtomic(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  if (report.missing.length || report.failures.length) {
    throw new Error(`编队头像尚未完整：无法映射 ${report.missing.length}，下载失败 ${report.failures.length}。详情见 scripts/data/squad-portrait-report.json；旧清单保留。`);
  }
  const items = resultItems;
  const manifest = { schemaVersion: 1, generatedAt: report.completedAt,
    source: { assetsRepository: 'ArknightsAssets/ArknightsAssets2', assetsCommit: ASSET_COMMIT,
      portraitTree: PORTRAIT_TREE, gameDataRepository: 'Kengxxiao/ArknightsGameData', gameDataCommit: GAME_DATA_COMMIT },
    count: items.length, elite2Count: report.elite2, baseCount: report.base,
    portraits: Object.fromEntries(items.map((item) => [item.operatorId, item.path])), items };
  const unchanged = previous?.schemaVersion === 1 && previous?.source?.assetsCommit === ASSET_COMMIT
    && previous?.source?.gameDataCommit === GAME_DATA_COMMIT
    && JSON.stringify(previous.items) === JSON.stringify(items);
  if (!unchanged) await writeAtomic(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  const check = await verifySquadPortraits();
  console.log(`编队头像同步完成：${check.count} 张，精二 ${check.elite2} 张，基础 ${check.base} 张${unchanged ? '，清单未变化' : ''}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error?.message ?? error); process.exitCode = 1; });
}
