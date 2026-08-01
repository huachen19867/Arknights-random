import assert from 'node:assert/strict';
import { parsePrtsModules, parsePrtsSkills } from './lib/operators.mjs';

const samples = new Map([
  ['史尔特尔', ['烈焰魔剑', '熔核巨影', '黄昏']],
  ['芬', ['冲锋号令·α型']],
  ['夜刀', []],
  ['Castle-3', []],
]);

const moduleSamples = new Map([
  ['史尔特尔', ['萨米的不灭心脏碎片', '旅游必需品']],
  ['砾', ['隐秘行动工具包']],
  ['夜刀', []],
]);

for (const [name, expectedNames] of samples) {
  const url = `https://m.prts.wiki/w/${encodeURIComponent(name)}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'ArknightsRandomTool/1.0 (PRTS parser sample check)' },
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200, `${name} 详情页 HTTP ${response.status}`);
  const html = await response.text();
  const skills = parsePrtsSkills(html);
  assert.deepEqual(skills.map((skill) => skill.name), expectedNames, `${name} 技能解析不符`);
  console.log(`${name}: ${skills.length > 0 ? skills.map((skill) => skill.name).join(' / ') : 'skills=[]'}`);
}

for (const [name, expectedModules] of moduleSamples) {
  const url = `https://m.prts.wiki/w/${encodeURIComponent(name)}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'ArknightsRandomTool/1.0 (PRTS parser sample check)' },
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200, `${name} 详情页 HTTP ${response.status}`);
  const modules = parsePrtsModules(await response.text());
  assert.deepEqual(modules.map((module) => module.name), expectedModules, `${name} 模组解析不符`);
  console.log(`${name}: ${modules.length > 0 ? modules.map((module) => module.name).join(' / ') : 'modules=[]'}`);
}

console.log('PRTS sample check: 7 operator cases passed');
