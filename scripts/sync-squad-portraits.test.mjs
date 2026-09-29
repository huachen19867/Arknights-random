import assert from 'node:assert/strict';
import test from 'node:test';
import { selectGameCharacter, selectPortraitSource } from './sync-squad-portraits.mjs';

const portraitNames = new Set([
  'char_002_amiya_1.png', 'char_002_amiya_2.png',
  'char_1001_amiya2_1.png', 'char_1001_amiya2_2.png',
  'char_1037_amiya3_1.png', 'char_1037_amiya3_2.png',
  'char_512_aprot_2.png', 'char_4025_aprot2_2.png',
]);
const records = [
  ['char_002_amiya', { name: '阿米娅', profession: 'CASTER', displayNumber: 'R001', phases: [1, 2, 3] }],
  ['char_1001_amiya2', { name: '阿米娅', profession: 'WARRIOR', displayNumber: 'R001', phases: [1, 2, 3] }],
  ['char_1037_amiya3', { name: '阿米娅', profession: 'MEDIC', displayNumber: 'R001', phases: [1, 2, 3] }],
  ['char_512_aprot', { name: '暮落', profession: 'TANK', displayNumber: null, isNotObtainable: true, phases: [1, 2, 3] }],
  ['char_4025_aprot2', { name: '暮落', profession: 'TANK', displayNumber: 'VC07', phases: [1, 2, 3] }],
];

test('阿米娅三种形态按职业匹配，正式暮落避开不可获得的临时角色', () => {
  for (const [name, profession, expected] of [
    ['阿米娅', '术师', 'char_002_amiya'],
    ['阿米娅(近卫)', '近卫', 'char_1001_amiya2'],
    ['阿米娅(医疗)', '医疗', 'char_1037_amiya3'],
    ['暮落', '重装', 'char_4025_aprot2'],
  ]) {
    const id = name.startsWith('阿米娅') ? `R001:${profession}` : 'VC07';
    assert.equal(selectGameCharacter({ id, name, profession }, records, portraitNames).charId, expected);
  }
  assert.equal(selectGameCharacter({ id: 'R001:特种', name: '阿米娅', profession: '特种' }, records, portraitNames).reason,
    'profession-mismatch');
});

test('仅能精二的角色选 _2，低星角色即使目录有 _2 也选基础图', () => {
  const files = new Map([
    ['char_sample_1.png', { path: 'char_sample_1.png', sha: 'one' }],
    ['char_sample_2.png', { path: 'char_sample_2.png', sha: 'two' }],
  ]);
  assert.deepEqual(selectPortraitSource('char_sample', files, true),
    { sourceFile: 'char_sample_2.png', gitSha: 'two', kind: 'elite2' });
  assert.deepEqual(selectPortraitSource('char_sample', files, false),
    { sourceFile: 'char_sample_1.png', gitSha: 'one', kind: 'base' });
});
