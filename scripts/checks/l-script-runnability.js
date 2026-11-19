import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ok, warn, info } from '../lib/report.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.dirname(HERE);

export const id = 'L';
export const title = '工作区脚本可跑性';

// 这里要拿退出码和 stderr 的前两行，不能走 lib/run.js 的「有输出就算成功」语义
const scriptChecks = [
  ['check-paths.mjs', '宿主路径解析'],
  ['check-skills.mjs', '技能注册'],
  ['persona-lint.mjs', '人格数字一致性'],
  ['check-persona-context.mjs', '人格注入'],
];

export async function check(ctx) {
  const out = [];
  for (const [file, label] of scriptChecks) {
    const p = path.join(ctx.WS, 'tools', file);
    if (!ctx.exists(p)) { out.push(warn(label + '：脚本不存在 ' + file)); continue; }
    try {
      execFileSync(process.execPath, [p], { encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'] });
      out.push(ok(label + '（' + file + '）'));
    } catch (e) {
      const txt = ((e.stdout || '') + (e.stderr || '')).split('\n').filter((l) => l.trim()).slice(0, 2).join(' ');
      out.push(warn(label + '（' + file + '）退出码 ' + e.status + '：' + txt.slice(0, 100)));
    }
  }
  // MCP server: 光有文件不算数，得起得来、认得出 initialize 协议。
  // agent 靠它发现工具，坏了就是静默降级成「只能自己 which」。
  const mcpServer = path.join(SCRIPTS_DIR, 'mcp', 'server.mjs');
  if (!ctx.exists(mcpServer)) {
    out.push(info('MCP server 不存在（scripts/mcp/server.mjs）—— agent 发现不了工具，只能自己探测'));
  } else {
    try {
      const probe = ctx.runNode(
        ['-e', "const{spawnSync}=require('child_process');const r=spawnSync(process.execPath,['" + mcpServer.replace(/\\/g, '/') + "'],{input:'{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\"}\\n',encoding:'utf8',timeout:15000});if(!r.stdout||!r.stdout.includes('protocolVersion')){process.exit(1)}"],
        { timeout: 20000 }
      );
      out.push(ok('MCP server 响应 initialize（3 个只读工具：env_status / tool_discover / tool_resolve）'));
    } catch (e) {
      out.push(warn('MCP server 存在但响应不了 initialize: ' + String(e.message || e).slice(0, 80)));
    }
  }

  return out;
}
