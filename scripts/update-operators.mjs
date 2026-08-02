import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 数据更新预览编排：只读发现官方更新并生成合并报告。
 * 不写 Base、不提交生成物；确认报告后再由老板显式执行各 --write 命令。
 *
 * 用法：
 *   node scripts/update-operators.mjs            # 完整预览（含飞书 Base 三组 preview）
 *   node scripts/update-operators.mjs --skip-base # 仅 PRTS 同步、样本检查与数据自检
 */

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const TEMP_DIRECTORY = path.join(SCRIPT_DIRECTORY, '.tmp');
const PRTS_DIFF_PATH = path.join(SCRIPT_DIRECTORY, 'data', 'prts-diff.json');
const BASE_DIFF_PATH = path.join(SCRIPT_DIRECTORY, 'data', 'base-diff.json');

function runStep(name, scriptName, args = []) {
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [path.join(SCRIPT_DIRECTORY, scriptName), ...args], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    env: process.env,
    timeout: 30 * 60 * 1000,
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join('');
  return {
    name,
    script: scriptName,
    args,
    ok: result.status === 0,
    status: result.status,
    durationMs: Date.now() - startedAt,
    tail: output.split(/\r?\n/).filter((line) => line.trim().length > 0).slice(-12).join('\n'),
  };
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return undefined;
  }
}

function snapshotBaseDiff(suffix) {
  const diff = readJson(BASE_DIFF_PATH);
  if (!diff) return undefined;
  const target = path.join(TEMP_DIRECTORY, `base-preview-${suffix}.json`);
  mkdirSync(TEMP_DIRECTORY, { recursive: true });
  writeFileSync(target, JSON.stringify(diff, null, 2), 'utf8');
  return diff;
}

function main() {
  const args = process.argv.slice(2);
  const skipBase = args.includes('--skip-base');
  if (args.includes('--help')) {
    console.log('用法：node scripts/update-operators.mjs [--skip-base]');
    console.log('  默认按 PRTS 同步 → 样本检查 → 数据自检 → Base 主表/技能/模组三组 preview 执行；');
    console.log('  --skip-base 跳过飞书 Base 三组 preview（无 LARK 凭证时使用）。');
    return;
  }

  mkdirSync(TEMP_DIRECTORY, { recursive: true });
  const steps = [
    runStep('PRTS 同步', 'sync-prts.mjs'),
    runStep('PRTS 真实样本检查', 'check-prts-samples.mjs'),
    runStep('数据自检', 'self-test.mjs'),
  ];

  let baseMain;
  let baseSkills;
  let baseModules;
  if (!skipBase) {
    steps.push(runStep('Base 主表 preview', 'base-upsert.mjs'));
    baseMain = snapshotBaseDiff('main');
    steps.push(runStep('Base 技能组 preview', 'base-upsert.mjs', ['--update-skills']));
    baseSkills = snapshotBaseDiff('skills');
    steps.push(runStep('Base 模组 preview', 'base-upsert.mjs', ['--update-modules']));
    baseModules = snapshotBaseDiff('modules');
  }

  const prts = readJson(PRTS_DIFF_PATH);
  const report = {
    generatedAt: new Date().toISOString(),
    steps: steps.map(({ name, script, args, ok, status, durationMs }) => ({ name, script, args, ok, status, durationMs })),
    prts: prts
      ? {
          previousCount: prts.previousCount,
          nextCount: prts.nextCount,
          additionCount: prts.additionCount,
          removalCount: prts.removalCount,
          changeCount: prts.changeCount,
          additions: prts.additions,
          removals: prts.removals,
          changes: prts.changes,
          validation: prts.validation,
          portraitExceptions: prts.portraitExceptions,
          transitionErrors: prts.transitionErrors ?? [],
        }
      : undefined,
    base: {
      main: baseMain
        ? {
            existingCount: baseMain.existingCount,
            missingCount: baseMain.missingCount,
            differentCount: baseMain.differentCount,
            differences: baseMain.differences,
          }
        : undefined,
      skills: baseSkills
        ? {
            existingCount: baseSkills.existingCount,
            missingCount: baseSkills.missingCount,
            differentCount: baseSkills.differentCount,
            differences: baseSkills.differences,
          }
        : undefined,
      modules: baseModules?.module
        ? {
            verifyNeeded: baseModules.module.verifyNeeded,
            createCount: baseModules.module.createCount,
            updateCount: baseModules.module.updateCount,
            differenceCount: baseModules.module.differenceCount,
            removalCount: baseModules.module.removalCount,
            creates: baseModules.module.creates.map((row) => ({ moduleId: row['模组ID'], operatorId: row['干员ID'], name: row['模组名称'] })),
            differences: baseModules.module.differences,
            removals: baseModules.module.removals,
          }
        : undefined,
    },
  };
  writeFileSync(path.join(TEMP_DIRECTORY, 'update-preview-report.json'), JSON.stringify(report, null, 2), 'utf8');
  printReport(report, steps);

  const failed = steps.filter((step) => !step.ok);
  const guards = [];
  if (report.prts) {
    if (report.prts.removalCount > 0) guards.push(`检测到 ${report.prts.removalCount} 名旧干员消失（removal guard）`);
    if ((report.prts.transitionErrors?.length ?? 0) > 0) guards.push(`版本迁移保护报错：${report.prts.transitionErrors.join('；')}`);
    if (report.prts.validation?.ok === false) guards.push('PRTS 数据校验失败');
    const unknownProfession = report.prts.validation?.professionCounts
      ? Object.keys(report.prts.validation.professionCounts).filter((key) => !['先锋', '近卫', '重装', '狙击', '术师', '医疗', '辅助', '特种'].includes(key))
      : [];
    if (unknownProfession.length > 0) guards.push(`出现八枚举之外的职业：${unknownProfession.join('、')}`);
  }
  if (failed.length > 0 || guards.length > 0) {
    console.error('\n[结果] 预览未通过，禁止写入。');
    if (guards.length > 0) console.error('安全护栏：\n- ' + guards.join('\n- '));
    process.exitCode = 1;
    return;
  }
  const additions = report.prts?.additionCount ?? 0;
  const changes = report.prts?.changeCount ?? 0;
  const creates = report.base.main?.missingCount ?? 0;
  const moduleCreates = report.base.modules?.createCount ?? 0;
  if (additions > 0 || changes > 0 || creates > 0 || moduleCreates > 0) {
    console.log('\n[结果] 发现官方更新：请人工确认上面的合并报告后，再显式执行写入命令（data:base:write / skills:write / modules:write）。');
  } else if (skipBase) {
    console.log('\n[结果] 未发现官方更新：PRTS 差异为 0（Base preview 已按 --skip-base 跳过）。');
  } else {
    console.log('\n[结果] 未发现官方更新：PRTS 与 Base 三组 preview 均为 0 差异。');
  }
}function printReport(report, steps) {
  console.log('='.repeat(72));
  console.log('数据更新预览合并报告');
  console.log(`生成时间：${report.generatedAt}`);
  console.log('='.repeat(72));
  for (const step of report.steps) {
    console.log(`[${step.ok ? '通过' : '失败'}] ${step.name}（node ${step.script} ${step.args.join(' ')}，${step.durationMs}ms）`);
  }
  const prts = report.prts;
  if (prts) {
    console.log('\n--- PRTS 差异 ---');
    console.log(`旧总数 ${prts.previousCount} → 新总数 ${prts.nextCount}；新增 ${prts.additionCount}，移除 ${prts.removalCount}，变化 ${prts.changeCount}`);
    if (prts.additions.length > 0) console.log(`新增干员：${prts.additions.map((item) => `${item.id} ${item.name}`).join('、')}`);
    if (prts.removals.length > 0) console.log(`疑似移除：${prts.removals.map((item) => `${item.id} ${item.name}`).join('、')}`);
    for (const change of prts.changes) {
      console.log(`变化：${change.id} ${change.name} → ${change.fields.map((field) => `${field.field}: ${String(field.before ?? '')} => ${String(field.after ?? '')}`).join('；')}`);
    }
    const validation = prts.validation;
    if (validation) {
      console.log(`数据校验：${validation.ok ? '通过' : '失败'}（${validation.count} 名）；星级 ${JSON.stringify(validation.rarityCounts)}；职业 ${JSON.stringify(validation.professionCounts)}；立绘 ${JSON.stringify(validation.portraitCounts)}；技能 ${JSON.stringify(validation.skillCounts)}；模组 ${JSON.stringify(validation.moduleCounts)}`);
    }
    if (prts.transitionErrors.length > 0) console.log(`迁移保护：${prts.transitionErrors.join('；')}`);
  }
  const base = report.base;
  if (base && !base.main && !base.skills && !base.modules) {
    console.log('\n--- Base preview ---');
    console.log('（--skip-base：未执行 Base 三组 preview，需在授权本机运行完整版 data:update:preview）');
  } else if (base) {
    console.log('\n--- Base 主表 preview ---');
    if (base.main) console.log(`已有 ${base.main.existingCount} 条；新建 ${base.main.missingCount} 条；已有差异 ${base.main.differentCount} 条`);
    for (const diff of base.main?.differences ?? []) {
      console.log(`  主表差异 ${diff.id} ${diff.name}: ${diff.changes.map((change) => `${change.field}: ${String(change.base ?? '')} => ${String(change.prts ?? '')}`).join('；')}`);
    }
    console.log('\n--- Base 技能组 preview ---');
    if (base.skills) console.log(`新建 ${base.skills.missingCount} 条；技能差异 ${base.skills.differentCount} 条`);
    for (const diff of base.skills?.differences ?? []) {
      const skillFields = diff.changes.filter((change) => change.field.startsWith('技能') || change.field === '技能已核验');
      if (skillFields.length > 0) {
        console.log(`  技能差异 ${diff.id} ${diff.name}: ${skillFields.map((change) => `${change.field}: ${String(change.base ?? '')} => ${String(change.prts ?? '')}`).join('；')}`);
      }
    }
    console.log('\n--- Base 模组 preview ---');
    if (base.modules) {
      console.log(`需核验 ${base.modules.verifyNeeded} 条；新建 ${base.modules.createCount} 行；差异 ${base.modules.differenceCount} 行；疑似移除 ${base.modules.removalCount} 行`);
      if (base.modules.creates.length > 0) console.log(`  新建模组：${base.modules.creates.map((row) => `${row.moduleId}（${row.name}）`).join('、')}`);
      for (const diff of base.modules.differences) {
        console.log(`  模组差异 ${diff.moduleId}（${diff.operatorId}）: ${diff.fields.join('、')}`);
      }
      for (const removal of base.modules.removals) {
        console.log(`  疑似移除模组 ${removal.moduleId}（${removal.operatorId}）——只报告，不物理删除`);
      }
    }
  }
  const stepTails = steps.map((step) => ({ name: step.name, ok: step.ok, tail: step.tail }));
  const failedTails = stepTails.filter((step) => !step.ok);
  if (failedTails.length > 0) {
    console.log('\n--- 失败步骤输出 ---');
    for (const failed of failedTails) {
      console.log(`>>> ${failed.name}\n${failed.tail}`);
    }
  }
}

main();