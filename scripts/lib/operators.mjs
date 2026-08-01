import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const SCHEMA_VERSION = 1;
export const PROFESSIONS = Object.freeze([
  '先锋',
  '近卫',
  '重装',
  '狙击',
  '术师',
  '医疗',
  '辅助',
  '特种',
]);

export const BASE_SKILL_FIELDS = Object.freeze(['技能1', '技能2', '技能3']);
export const BASE_SKILL_VERIFIED_FIELD = '技能已核验';

export const BASE_FIELDS = Object.freeze([
  '干员ID',
  '名称',
  '星级',
  '职业',
  '启用',
  '立绘URL',
  '来源URL',
  '同步时间',
  ...BASE_SKILL_FIELDS,
  BASE_SKILL_VERIFIED_FIELD,
]);

export function verifyBaseFieldSchema(fields) {
  const byName = new Map(fields.map((field) => [
    field?.field_name ?? field?.name ?? field?.fieldName,
    field,
  ]));
  const missing = BASE_FIELDS.filter((name) => !byName.has(name));
  if (missing.length > 0) throw new Error(`Base 缺少字段: ${missing.join(', ')}`);

  const expectedTypes = {
    '干员ID': 'text',
    '名称': 'text',
    '星级': 'number',
    '职业': 'select',
    '启用': 'checkbox',
    '立绘URL': 'text',
    '来源URL': 'text',
    '同步时间': 'datetime',
    '技能1': 'text',
    '技能2': 'text',
    '技能3': 'text',
    '技能已核验': 'checkbox',
  };
  for (const [name, expected] of Object.entries(expectedTypes)) {
    const actual = byName.get(name)?.type;
    if (actual !== expected) throw new Error(`Base 字段 ${name} 类型应为 ${expected}，实际为 ${actual}`);
  }
  const profession = byName.get('职业');
  if (profession.multiple !== false) throw new Error('Base 字段 职业 必须是单选');
  const options = new Set((profession.options ?? []).map((option) => option.name));
  const missingOptions = PROFESSIONS.filter((name) => !options.has(name));
  if (missingOptions.length > 0) throw new Error(`Base 职业字段缺少选项: ${missingOptions.join(', ')}`);
  for (const name of ['立绘URL', '来源URL']) {
    if (byName.get(name)?.style?.type !== 'url') throw new Error(`Base 字段 ${name} 必须为 URL 样式文本`);
  }
}

export function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      result._.push(token);
      continue;
    }
    const equalsAt = token.indexOf('=');
    if (equalsAt >= 0) {
      result[token.slice(2, equalsAt)] = token.slice(equalsAt + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}

export function decodeHtmlAttribute(value) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: '\u00a0',
    quot: '"',
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, body) => {
    if (body[0] === '#') {
      const hexadecimal = body[1]?.toLowerCase() === 'x';
      const codePoint = Number.parseInt(body.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    return named[body.toLowerCase()] ?? entity;
  });
}

export function parsePrtsOperators(html) {
  if (!html.includes('id="filter-data"') && !html.includes("id='filter-data'")) {
    throw new Error('PRTS 页面中缺少 #filter-data，页面结构可能已改变');
  }

  const operators = [];
  const divPattern = /<div\b([^>]*\bdata-id\s*=\s*(?:"[^"]*"|'[^']*')[^>]*)>/gi;
  for (const match of html.matchAll(divPattern)) {
    const attributes = {};
    const attributePattern = /\b(data-[\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
    for (const attribute of match[1].matchAll(attributePattern)) {
      attributes[attribute[1].toLowerCase()] = decodeHtmlAttribute(attribute[2] ?? attribute[3] ?? '');
    }
    if (!attributes['data-id'] || !attributes['data-zh']) continue;
    if (attributes['data-rarity'] === undefined || !attributes['data-profession']) continue;

    operators.push({
      id: attributes['data-id'].trim(),
      name: attributes['data-zh'].trim(),
      rarity: Number.parseInt(attributes['data-rarity'], 10) + 1,
      profession: attributes['data-profession'].trim(),
    });
  }
  const idCounts = new Map();
  for (const operator of operators) idCounts.set(operator.id, (idCounts.get(operator.id) ?? 0) + 1);
  const resolvedIds = new Set();
  return operators.map((operator) => {
    const prtsId = operator.id;
    let id = prtsId;
    if (idCounts.get(prtsId) > 1) id = `${prtsId}:${operator.profession}`;
    if (resolvedIds.has(id)) id = `${prtsId}:${operator.name}`;
    if (resolvedIds.has(id)) throw new Error(`PRTS 干员主键仍冲突: ${id}`);
    resolvedIds.add(id);
    return { ...operator, id, prtsId };
  });
}

function htmlFragmentToText(fragment) {
  return decodeHtmlAttribute(
    String(fragment)
      .replace(/<br\s*\/?\s*>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

export function parsePrtsSkills(html) {
  const marker = html.search(/<span\b[^>]*\bid=["']技能["'][^>]*>/i);
  if (marker < 0) throw new Error('PRTS 页面缺少技能章节，页面结构可能已改变');
  const tail = html.slice(marker);
  const nextHeadingOffset = tail.slice(1).search(/<h2\b/i);
  const section = nextHeadingOffset < 0 ? tail : tail.slice(0, nextHeadingOffset + 1);
  const headings = [...section.matchAll(/<p>\s*<b>\s*技能\s*([1-3])(?:[^<]*)<\/b>\s*<\/p>/gi)];
  if (headings.length === 0) {
    if (htmlFragmentToText(section).includes('该干员没有技能')) return [];
    throw new Error('PRTS 技能章节既没有技能小节，也没有明确的“该干员没有技能”说明');
  }
  const skills = headings.map((heading, index) => {
    const block = section.slice(heading.index, headings[index + 1]?.index ?? section.length);
    const nameMatch = block.match(/<big\b[^>]*>([\s\S]*?)<\/big>/i);
    const fileLinks = [...block.matchAll(/href=["']\/w\/([^"']+)["']/gi)];
    const fileName = fileLinks
      .map((match) => {
        try {
          return decodeURIComponent(match[1]);
        } catch {
          return '';
        }
      })
      .find((value) => value.startsWith('文件:技能_'));
    const skillIndex = Number(heading[1]);
    const nameFromFile = fileName
      ? decodeHtmlAttribute(fileName.replace(/^文件:技能_/, '').replace(/\.(?:png|jpe?g|gif|webp|svg)$/i, ''))
      : '';
    const name = nameFromFile || (nameMatch ? htmlFragmentToText(nameMatch[1]) : '');
    if (!name) throw new Error(`PRTS 技能${skillIndex} 缺少名称，页面结构可能已改变`);
    return { index: skillIndex, name };
  });
  const indexes = new Set(skills.map((skill) => skill.index));
  if (indexes.size !== skills.length) throw new Error('PRTS 技能章节存在重复技能编号');
  return skills.sort((left, right) => left.index - right.index);
}

function operatorPrtsId(operator) {
  const value = String(operator?.prtsId ?? operator?.id ?? '').trim();
  return value.includes(':') ? value.slice(0, value.indexOf(':')) : value;
}

function groupByPrtsId(operators) {
  const groups = new Map();
  for (const operator of operators) {
    const prtsId = operatorPrtsId(operator);
    if (!prtsId) throw new Error(`干员缺少 PRTS ID: ${JSON.stringify(operator)}`);
    const group = groups.get(prtsId) ?? [];
    group.push(operator);
    groups.set(prtsId, group);
  }
  return groups;
}

function nextAvailableId(proposals, reservedIds, assignedIds) {
  for (const proposal of proposals) {
    if (proposal && !reservedIds.has(proposal) && !assignedIds.has(proposal)) return proposal;
  }
  const base = proposals.find(Boolean);
  if (!base) throw new Error('无法为新干员生成稳定 ID');
  for (let suffix = 2; ; suffix += 1) {
    const proposal = `${base}#${suffix}`;
    if (!reservedIds.has(proposal) && !assignedIds.has(proposal)) return proposal;
  }
}

export function reconcileStableOperatorIds(incomingOperators, previousOperators = []) {
  const incoming = incomingOperators.map((operator) => ({
    ...operator,
    prtsId: operatorPrtsId(operator),
  }));
  const previous = previousOperators.map((operator) => ({
    ...operator,
    prtsId: operatorPrtsId(operator),
  }));
  const incomingGroups = groupByPrtsId(incoming);
  const previousGroups = groupByPrtsId(previous);
  const reservedIds = new Set(previous.map((operator) => operator.id));
  const assignedIds = new Set();
  const resolved = [];

  for (const [prtsId, incomingGroup] of incomingGroups) {
    const previousGroup = previousGroups.get(prtsId) ?? [];
    const claimedPreviousIds = new Set();
    const groupResults = new Map();

    for (const operator of incomingGroup) {
      const exact = previousGroup.find((candidate) => (
        !claimedPreviousIds.has(candidate.id)
        && candidate.name === operator.name
        && candidate.profession === operator.profession
      ));
      if (exact) {
        claimedPreviousIds.add(exact.id);
        groupResults.set(operator, exact.id);
        assignedIds.add(exact.id);
      }
    }

    for (const operator of incomingGroup) {
      if (groupResults.has(operator)) continue;
      const remainingSameName = previousGroup.filter((candidate) => (
        !claimedPreviousIds.has(candidate.id) && candidate.name === operator.name
      ));
      const unmatchedIncomingNameCount = incomingGroup.filter((candidate) => (
        !groupResults.has(candidate) && candidate.name === operator.name
      )).length;
      if (remainingSameName.length === 1 && unmatchedIncomingNameCount === 1) {
        const [matched] = remainingSameName;
        claimedPreviousIds.add(matched.id);
        groupResults.set(operator, matched.id);
        assignedIds.add(matched.id);
      }
    }

    for (const operator of incomingGroup) {
      if (groupResults.has(operator)) continue;
      const remainingSameProfession = previousGroup.filter((candidate) => (
        !claimedPreviousIds.has(candidate.id) && candidate.profession === operator.profession
      ));
      const unmatchedIncomingProfessionCount = incomingGroup.filter((candidate) => (
        !groupResults.has(candidate) && candidate.profession === operator.profession
      )).length;
      if (remainingSameProfession.length === 1 && unmatchedIncomingProfessionCount === 1) {
        const [matched] = remainingSameProfession;
        claimedPreviousIds.add(matched.id);
        groupResults.set(operator, matched.id);
        assignedIds.add(matched.id);
      }
    }

    if (incomingGroup.length === 1 && previousGroup.length === 1 && !groupResults.has(incomingGroup[0])) {
      const [operator] = incomingGroup;
      const [matched] = previousGroup;
      claimedPreviousIds.add(matched.id);
      groupResults.set(operator, matched.id);
      assignedIds.add(matched.id);
    }

    for (const operator of incomingGroup) {
      let id = groupResults.get(operator);
      if (!id) {
        const proposals = [
          incomingGroup.length === 1 ? prtsId : undefined,
          `${prtsId}:${operator.profession}`,
          `${prtsId}:${operator.name}`,
        ];
        id = nextAvailableId(proposals, reservedIds, assignedIds);
        assignedIds.add(id);
      }
      resolved.push({ ...operator, id, prtsId });
    }
  }

  if (resolved.length !== incoming.length || assignedIds.size !== incoming.length) {
    throw new Error('稳定 ID 对账失败：结果数量或唯一 ID 数量不一致');
  }
  return resolved;
}

const VERSIONED_OPERATOR_FIELDS = Object.freeze([
  'prtsId',
  'name',
  'rarity',
  'profession',
  'portrait',
  'portraitKind',
  'sourceUrl',
  'skills',
]);

function versionedValue(operator, field) {
  const value = field === 'prtsId' ? operatorPrtsId(operator) : operator[field];
  return value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
}

export function diffOperatorVersions(previousOperators, nextOperators) {
  const previousById = new Map(previousOperators.map((operator) => [operator.id, operator]));
  const nextById = new Map(nextOperators.map((operator) => [operator.id, operator]));
  const additions = [];
  const removals = [];
  const changes = [];

  for (const operator of nextOperators) {
    const previous = previousById.get(operator.id);
    if (!previous) {
      additions.push({
        id: operator.id,
        prtsId: operatorPrtsId(operator),
        name: operator.name,
        rarity: operator.rarity,
        profession: operator.profession,
      });
      continue;
    }
    const fields = VERSIONED_OPERATOR_FIELDS.flatMap((field) => {
      const before = field === 'prtsId' ? operatorPrtsId(previous) : previous[field];
      const after = field === 'prtsId' ? operatorPrtsId(operator) : operator[field];
      return versionedValue(previous, field) === versionedValue(operator, field) ? [] : [{ field, before, after }];
    });
    if (fields.length > 0) changes.push({ id: operator.id, name: operator.name, fields });
  }

  for (const operator of previousOperators) {
    if (!nextById.has(operator.id)) {
      removals.push({
        id: operator.id,
        prtsId: operatorPrtsId(operator),
        name: operator.name,
        rarity: operator.rarity,
        profession: operator.profession,
      });
    }
  }

  return {
    previousCount: previousOperators.length,
    nextCount: nextOperators.length,
    unchangedCount: nextOperators.length - additions.length - changes.length,
    additionCount: additions.length,
    removalCount: removals.length,
    changeCount: changes.length,
    additions,
    removals,
    changes,
  };
}

export function validateVersionTransition(diff, options = {}) {
  if (diff.previousCount === 0) return [];
  const maximumAdditions = Number(options.maximumAdditions ?? 50);
  const maximumChanges = Number(options.maximumChanges ?? 50);
  const errors = [];
  if (diff.removalCount > 0 && !options.allowRemovals) {
    errors.push(`检测到 ${diff.removalCount} 名旧干员消失；默认禁止删除，请检查 PRTS 页面或显式传入 --allow-removals`);
  }
  if (diff.additionCount > maximumAdditions) {
    errors.push(`单次新增 ${diff.additionCount} 名，超过安全上限 ${maximumAdditions}`);
  }
  if (diff.changeCount > maximumChanges) {
    errors.push(`单次变更 ${diff.changeCount} 名，超过安全上限 ${maximumChanges}`);
  }
  return errors;
}

export function createDataset(operators, options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    source: options.source ?? {
      kind: 'prts',
      url: 'https://m.prts.wiki/w/%E5%B9%B2%E5%91%98%E4%B8%80%E8%A7%88',
    },
    count: operators.length,
    operators,
  };
}

export function normalizeDataset(value) {
  if (Array.isArray(value)) return createDataset(value, { source: { kind: 'unknown' } });
  if (!value || !Array.isArray(value.operators)) {
    throw new Error('JSON 必须是干员数组，或包含 operators 数组的数据集对象');
  }
  return value;
}

export async function readDataset(filePath) {
  return normalizeDataset(JSON.parse(await readFile(filePath, 'utf8')));
}

export function validateDataset(dataset, options = {}) {
  const normalized = normalizeDataset(dataset);
  const minimumCount = Number(options.minimumCount ?? 1);
  const errors = [];
  const warnings = [];
  const ids = new Set();
  const names = new Set();
  const rarityCounts = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [index + 1, 0]));
  const professionCounts = Object.fromEntries(PROFESSIONS.map((profession) => [profession, 0]));
  const portraitCounts = {};
  const skillCounts = { unknown: 0, ...Object.fromEntries(Array.from({ length: 4 }, (_, count) => [count, 0])) };

  if (normalized.operators.length < minimumCount) {
    errors.push(`干员数 ${normalized.operators.length} 小于安全下限 ${minimumCount}`);
  }
  for (const [index, operator] of normalized.operators.entries()) {
    const label = `operators[${index}]`;
    if (!operator || typeof operator !== 'object') {
      errors.push(`${label} 不是对象`);
      continue;
    }
    if (typeof operator.id !== 'string' || !operator.id.trim()) errors.push(`${label}.id 缺失`);
    else if (ids.has(operator.id)) errors.push(`重复干员 ID: ${operator.id}`);
    else ids.add(operator.id);
    if (typeof operator.name !== 'string' || !operator.name.trim()) errors.push(`${label}.name 缺失`);
    else if (names.has(operator.name)) warnings.push(`重复干员名称: ${operator.name}`);
    else names.add(operator.name);
    if (!Number.isInteger(operator.rarity) || operator.rarity < 1 || operator.rarity > 6) {
      errors.push(`${label}.rarity 必须为 1-6 的整数`);
    } else {
      rarityCounts[operator.rarity] += 1;
    }
    if (!PROFESSIONS.includes(operator.profession)) {
      errors.push(`${label}.profession 非法: ${operator.profession}`);
    } else {
      professionCounts[operator.profession] += 1;
    }
    if (operator.enabled !== undefined && typeof operator.enabled !== 'boolean') {
      errors.push(`${label}.enabled 必须为 boolean`);
    }
    if (typeof operator.portrait !== 'string' || !/^https:\/\//.test(operator.portrait)) {
      errors.push(`${label}.portrait 不是 HTTPS URL`);
    }
    if (typeof operator.sourceUrl !== 'string' || !/^https:\/\//.test(operator.sourceUrl)) {
      errors.push(`${label}.sourceUrl 不是 HTTPS URL`);
    }
    if (operator.skills === undefined && options.allowUnknownSkills) {
      skillCounts.unknown += 1;
    } else if (!Array.isArray(operator.skills) || operator.skills.length > 3) {
      errors.push(`${label}.skills 必须是最多 3 项的数组`);
    } else {
      skillCounts[operator.skills.length] += 1;
      operator.skills.forEach((skill, skillOffset) => {
        if (!skill || skill.index !== skillOffset + 1 || typeof skill.name !== 'string' || !skill.name.trim()) {
          errors.push(`${label}.skills[${skillOffset}] 必须包含连续编号 index=${skillOffset + 1} 和非空名称`);
        }
      });
    }
    const portraitKind = operator.portraitKind ?? 'unknown';
    portraitCounts[portraitKind] = (portraitCounts[portraitKind] ?? 0) + 1;
  }

  for (const profession of PROFESSIONS) {
    if (normalized.operators.length >= 100 && professionCounts[profession] === 0) {
      errors.push(`职业 ${profession} 计数为 0`);
    }
  }
  for (const rarity of Object.keys(rarityCounts)) {
    if (normalized.operators.length >= 100 && rarityCounts[rarity] === 0) {
      errors.push(`${rarity} 星干员计数为 0`);
    }
  }

  return {
    ok: errors.length === 0,
    count: normalized.operators.length,
    errors,
    warnings,
    rarityCounts,
    professionCounts,
    portraitCounts,
    skillCounts,
  };
}

export async function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, filePath);
}

export function chunk(items, size = 200) {
  if (!Number.isInteger(size) || size < 1 || size > 200) {
    throw new Error('飞书 Base 批次大小必须在 1-200 之间');
  }
  const batches = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

export function unwrapCellValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;
    if (value.length === 1) return unwrapCellValue(value[0]);
    return value.map(unwrapCellValue);
  }
  for (const key of ['text', 'name', 'value', 'link']) {
    if (value[key] !== undefined && typeof value[key] !== 'object') return value[key];
  }
  return value;
}

export function unwrapUrlCellValue(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.length > 0 ? unwrapUrlCellValue(value[0]) : undefined;
  if (typeof value === 'object' && typeof value.link === 'string') return value.link;
  if (typeof value === 'string') {
    const text = value.trim();
    const linkSeparator = text.indexOf('](');
    if (text.startsWith('[') && linkSeparator > 0 && text.endsWith(')')) {
      const target = text.slice(linkSeparator + 2, -1);
      if (target.startsWith('https://')) return target;
    }
    return text;
  }
  return unwrapCellValue(value);
}

export function inferPortraitKind(url) {
  const decoded = decodeURIComponent(String(url));
  if (decoded.includes('头像_')) return 'avatar';
  if (decoded.includes('_2.png')) return 'elite2';
  if (decoded.includes('_1.png')) return 'elite1';
  return 'custom';
}

export function toLarkDateTime(value, timeZone = 'Asia/Shanghai') {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error(`无效时间: ${value}`);
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return formatter.format(date);
}

export function larkDateTimeToIso(value, offset = '+08:00') {
  if (typeof value === 'number') return new Date(value).toISOString();
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    return new Date(`${text.replace(' ', 'T')}${offset}`).toISOString();
  }
  const date = new Date(text);
  return Number.isNaN(date.valueOf()) ? text : date.toISOString();
}
