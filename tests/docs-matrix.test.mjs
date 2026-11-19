import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

// 2026-11-19 审查一般 #7：代码已经能自动装，README / SKILL 还写着「只检查不装」。
// 这个锚点只能钉住「已知的旧说法不许回来」，不是完整的文档一致性检查——
// 新增安装动作时还是要手动同步两张表（README 的和 SKILL.md 的）。
test('文档不再对可自动装的工具说「只检查不装」（审查一般 #7 回归锚点）', () => {
  const stale = ['只检查不装', '脚本不装', 'puppeteer 只提示', '只提示，不装'];
  for (const f of ['README.md', 'README.en.md', 'SKILL.md']) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const phrase of stale) {
      assert.ok(!s.includes(phrase), f + ' 里还有旧说法「' + phrase + '」——这些工具现在会自动装');
    }
  }
});
