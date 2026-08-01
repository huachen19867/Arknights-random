import assert from 'node:assert/strict';
import {
  chunk,
  createDataset,
  decodeHtmlAttribute,
  diffOperatorVersions,
  inferPortraitKind,
  parsePrtsOperators,
  parsePrtsSkills,
  reconcileStableOperatorIds,
  toLarkDateTime,
  unwrapCellValue,
  unwrapUrlCellValue,
  validateDataset,
  validateVersionTransition,
} from './lib/operators.mjs';
import { portraitCandidates } from './sync-prts.mjs';
import { isRetryableLarkWriteLimit, LarkCliError, normalizeRecordPage } from './lib/lark-cli.mjs';
import { recordsToOperators } from './base-export.mjs';

const fixture = `
  <div id="filter-data">
    <div data-profession="术师" data-id="R303" data-zh="12F" data-rarity="1">...</div>
    <div data-zh="A&amp;B" data-rarity="5" data-id="TEST" data-profession="特种">...</div>
  </div>`;
const parsed = parsePrtsOperators(fixture);
assert.deepEqual(parsed, [
  { id: 'R303', prtsId: 'R303', name: '12F', rarity: 2, profession: '术师' },
  { id: 'TEST', prtsId: 'TEST', name: 'A&B', rarity: 6, profession: '特种' },
]);
assert.equal(decodeHtmlAttribute('A&#x26;B'), 'A&B');
assert.deepEqual(parsePrtsSkills(`
  <h2><span class="mw-headline" id="技能">技能</span></h2><section>
  <p><b>技能1（精英0开放）</b></p><a href="/w/%E6%96%87%E4%BB%B6%3A%E6%8A%80%E8%83%BD_%E5%86%B2%E9%94%8B%E5%8F%B7%E4%BB%A4%C2%B7%CE%B1%E5%9E%8B.png">图标</a>
  <p><b>技能2（精英1开放）</b></p><a href="/w/%E6%96%87%E4%BB%B6%3A%E6%8A%80%E8%83%BD_%E6%B5%8B%E8%AF%95%E6%8A%80%E8%83%BD.png">图标</a>
  </section><h2>后勤技能</h2>`), [
  { index: 1, name: '冲锋号令·α型' },
  { index: 2, name: '测试技能' },
]);
assert.deepEqual(parsePrtsSkills('<h2><span id="技能">技能</span></h2><p>该干员没有技能</p><h2>后勤技能</h2>'), []);
assert.throws(() => parsePrtsSkills('<h2><span id="后勤技能">后勤技能</span></h2>'), /缺少技能章节/);
assert.throws(
  () => parsePrtsSkills('<h2><span id="技能">技能</span></h2><p>页面结构异常</p><h2>后勤技能</h2>'),
  /既没有技能小节/,
);
assert.equal(
  unwrapUrlCellValue('[PRTS](https://prts.wiki/w/test)'),
  'https://prts.wiki/w/test',
);
assert.equal(
  unwrapUrlCellValue('[阿米娅](https://prts.wiki/w/%E9%98%BF%E7%B1%B3%E5%A8%85(%E8%BF%91%E5%8D%AB))'),
  'https://prts.wiki/w/%E9%98%BF%E7%B1%B3%E5%A8%85(%E8%BF%91%E5%8D%AB)',
);

const portraits = portraitCandidates('维什戴尔');
assert.equal(
  portraits[0].url,
  'https://media.prts.wiki/thumb/9/94/%E7%AB%8B%E7%BB%98_%E7%BB%B4%E4%BB%80%E6%88%B4%E5%B0%94_2.png/800px-%E7%AB%8B%E7%BB%98_%E7%BB%B4%E4%BB%80%E6%88%B4%E5%B0%94_2.png?image_process=format,webp/quality,Q_80',
);
assert.equal(portraits[2].url, 'https://media.prts.wiki/6/66/%E5%A4%B4%E5%83%8F_%E7%BB%B4%E4%BB%80%E6%88%B4%E5%B0%94.png');
assert.equal(inferPortraitKind(portraits[0].url), 'elite2');
assert.equal(inferPortraitKind(portraits[2].url), 'avatar');

assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
assert.throws(() => chunk([1], 201), /1-200/);
assert.equal(unwrapCellValue([{ text: 'R303' }]), 'R303');
assert.equal(toLarkDateTime('2026-08-01T00:00:00.000Z'), '2026-08-01 08:00:00');

const valid = createDataset([{
  id: 'R303',
  name: '12F',
  rarity: 2,
  profession: '术师',
  enabled: true,
  portrait: portraits[1].url,
  portraitKind: 'elite1',
  sourceUrl: 'https://prts.wiki/w/12F',
  skills: [],
  updatedAt: '2026-08-01T00:00:00.000Z',
}]);
assert.equal(validateDataset(valid).ok, true);
const duplicate = createDataset([...valid.operators, { ...valid.operators[0] }]);
assert.equal(validateDataset(duplicate).ok, false);

const forms = parsePrtsOperators(`
  <div id="filter-data">
    <div data-id="R001" data-zh="阿米娅" data-rarity="4" data-profession="术师"></div>
    <div data-id="R001" data-zh="阿米娅(医疗)" data-rarity="4" data-profession="医疗"></div>
  </div>`);
assert.deepEqual(forms.map(({ id, prtsId }) => ({ id, prtsId })), [
  { id: 'R001:术师', prtsId: 'R001' },
  { id: 'R001:医疗', prtsId: 'R001' },
]);

const reconciled = reconcileStableOperatorIds([
  { id: 'R001:术师', prtsId: 'R001', name: '阿米娅', rarity: 5, profession: '术师' },
  { id: 'R001:近卫', prtsId: 'R001', name: '阿米娅(近卫)', rarity: 5, profession: '近卫' },
], [{ id: 'R001', prtsId: 'R001', name: '阿米娅', rarity: 5, profession: '术师' }]);
assert.equal(reconciled.find((operator) => operator.profession === '术师').id, 'R001');
assert.equal(reconciled.find((operator) => operator.profession === '近卫').id, 'R001:近卫');
const renamed = reconcileStableOperatorIds([
  { id: 'R001:近卫', prtsId: 'R001', name: '阿米娅(剑)', rarity: 5, profession: '近卫' },
], [{ id: 'R001:近卫', prtsId: 'R001', name: '阿米娅(近卫)', rarity: 5, profession: '近卫' }]);
assert.equal(renamed[0].id, 'R001:近卫');
const changedProfession = reconcileStableOperatorIds([
  { id: 'P100', prtsId: 'P100', name: '测试干员', rarity: 5, profession: '近卫' },
], [{ id: 'P100', prtsId: 'P100', name: '测试干员', rarity: 5, profession: '术师' }]);
assert.equal(changedProfession[0].id, 'P100');
const multiFormProfessionChange = reconcileStableOperatorIds([
  { id: 'R001:狙击', prtsId: 'R001', name: '阿米娅', rarity: 5, profession: '狙击' },
  { id: 'R001:医疗', prtsId: 'R001', name: '阿米娅(医疗)', rarity: 5, profession: '医疗' },
  { id: 'R001:近卫', prtsId: 'R001', name: '阿米娅(近卫)', rarity: 5, profession: '近卫' },
], [
  { id: 'R001:术师', prtsId: 'R001', name: '阿米娅', rarity: 5, profession: '术师' },
  { id: 'R001:医疗', prtsId: 'R001', name: '阿米娅(医疗)', rarity: 5, profession: '医疗' },
  { id: 'R001:近卫', prtsId: 'R001', name: '阿米娅(近卫)', rarity: 5, profession: '近卫' },
]);
assert.equal(multiFormProfessionChange.find((operator) => operator.name === '阿米娅').id, 'R001:术师');

const versionDiff = diffOperatorVersions(
  [{ ...valid.operators[0], skills: [] }],
  [{ ...valid.operators[0], skills: [{ index: 1, name: '新技能' }] }],
);
assert.equal(versionDiff.changeCount, 1);
assert.deepEqual(versionDiff.changes[0].fields.map(({ field }) => field), ['skills']);
assert.equal(validateVersionTransition({ ...versionDiff, previousCount: 1 }, { maximumChanges: 0 }).length, 1);
assert.equal(validateVersionTransition({
  previousCount: 1, additionCount: 2, removalCount: 0, changeCount: 0,
}, { maximumAdditions: 1 }).length, 1);
assert.equal(validateVersionTransition({
  previousCount: 1, additionCount: 0, removalCount: 1, changeCount: 0,
}).length, 1);
assert.equal(validateVersionTransition({
  previousCount: 1, additionCount: 0, removalCount: 1, changeCount: 0,
}, { allowRemovals: true }).length, 0);

const matrixRecords = normalizeRecordPage({
  ok: true,
  data: {
    fields: ['干员ID', '名称'],
    data: [['R303', '12F'], ['R001:术师', '阿米娅']],
    record_id_list: ['rec_a', 'rec_b'],
    has_more: false,
  },
});
assert.deepEqual(matrixRecords, [
  { record_id: 'rec_a', fields: { '干员ID': 'R303', '名称': '12F' } },
  { record_id: 'rec_b', fields: { '干员ID': 'R001:术师', '名称': '阿米娅' } },
]);
assert.equal(isRetryableLarkWriteLimit(new LarkCliError('limited', { code: 1254290 })), true);
assert.equal(isRetryableLarkWriteLimit(new LarkCliError('the method：OpenAPIBatchUpdateRecords limited')), true);
assert.equal(isRetryableLarkWriteLimit(new LarkCliError('普通字段校验失败', { code: 1254015 })), false);

const exportFixture = recordsToOperators([
  { record_id: 'blank', fields: { '启用': false } },
  {
    record_id: 'enabled',
    fields: {
      '干员ID': 'R303', '名称': '12F', '星级': 2, '职业': '术师', '启用': true,
      '立绘URL': [{ link: portraits[1].url, text: '12F' }],
      '来源URL': 'https://prts.wiki/w/12F', '同步时间': '2026-08-01 08:00:00',
      '技能1': '二连射·自动', '技能2': null, '技能3': null, '技能已核验': true,
    },
  },
  {
    record_id: 'string-checkbox',
    fields: {
      '干员ID': 'TEST', '名称': 'Test', '星级': 1, '职业': '先锋', '启用': 'true',
      '立绘URL': portraits[1].url, '来源URL': 'https://example.com', '同步时间': '2026-08-01 08:00:00',
    },
  },
]);
assert.equal(exportFixture.skippedBlank, 1);
assert.equal(exportFixture.skippedDisabled, 1);
assert.equal(exportFixture.operators.length, 1);
assert.equal(exportFixture.operators[0].portrait, portraits[1].url);
assert.deepEqual(exportFixture.operators[0].skills, [{ index: 1, name: '二连射·自动' }]);
assert.throws(() => recordsToOperators([{ record_id: 'half', fields: { '干员ID': 'HALF' } }]), /半填行/);

const unknownSkills = recordsToOperators([{
  record_id: 'unknown-skills',
  fields: {
    '干员ID': 'R303', '名称': '12F', '星级': 2, '职业': '术师', '启用': true,
    '立绘URL': portraits[1].url, '来源URL': 'https://prts.wiki/w/12F', '同步时间': '2026-08-01 08:00:00',
    '技能已核验': false,
  },
}]);
assert.equal(Object.hasOwn(unknownSkills.operators[0], 'skills'), false);
assert.throws(() => recordsToOperators([{
  record_id: 'skill-gap',
  fields: {
    '干员ID': 'GAP', '名称': 'Gap', '星级': 6, '职业': '术师', '启用': true,
    '立绘URL': portraits[1].url, '来源URL': 'https://example.com', '同步时间': '2026-08-01 08:00:00',
    '技能1': '一', '技能2': null, '技能3': '三', '技能已核验': true,
  },
}]), /技能编号不连续/);

console.log('self-test: 44 assertions passed');
