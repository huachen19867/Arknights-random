import assert from 'node:assert/strict';
import { parsePrtsSkills } from './lib/operators.mjs';

const samples = new Map([
  ['史尔特尔', ['烈焰魔剑', '熔核巨影', '黄昏']],
  ['芬', ['冲锋号令·α型']],
  ['夜刀', []],
  ['Castle-3', []],
]);

for (const [name, expectedNames] of samples) {
  const url = `https://m.prts.wiki/w/${encodeURIComponent(name)}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'ArknightsRandomTool/1.0 (PRTS parser sample check)' },
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200, `${name} 详情页 HTTP ${response.status}`);
  const skills = parsePrtsSkills(await response.text());
  assert.deepEqual(skills.map((skill) => skill.name), expectedNames, `${name} 技能解析不符`);
  console.log(`${name}: ${skills.length > 0 ? skills.map((skill) => skill.name).join(' / ') : 'skills=[]'}`);
}

console.log('PRTS sample check: 4 operators passed');
