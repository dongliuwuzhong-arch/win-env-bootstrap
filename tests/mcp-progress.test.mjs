import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'scripts', 'mcp', 'server.mjs');

// 收集所有行，直到拿到 id 相同的响应为止（progress 通知在响应之前）。
function callCollect(method, params, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    const lines = [];
    const t = setTimeout(() => { p.kill(); reject(new Error('MCP 超时: ' + out.slice(0, 300))); }, timeoutMs);
    p.stdout.on('data', (d) => {
      out += d.toString();
      let nl;
      while ((nl = out.indexOf('\n')) >= 0) {
        const s = out.slice(0, nl).trim();
        out = out.slice(nl + 1);
        if (!s) continue;
        try { lines.push(JSON.parse(s)); } catch { continue; }
        const resp = lines.find((m) => m.id === (params && params.id));
        if (resp) { clearTimeout(t); p.kill(); resolve(lines); return; }
      }
    });
    p.on('exit', () => { clearTimeout(t); resolve(lines); });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: params.id, method, params: { ...params, id: undefined } }) + '\n');
  });
}

test('env_status 带 progressToken：进度通知先于响应（审查建议 #11 回归）', async () => {
  const lines = await callCollect('tools/call', { id: 7, name: 'env_status', arguments: { only: '00', _meta: { progressToken: 'tok-1' } } });
  const progress = lines.filter((m) => m.method === 'notifications/progress');
  assert.ok(progress.length >= 1, '没发进度通知');
  assert.equal(progress[0].params.progressToken, 'tok-1');
  const resp = lines.find((m) => m.id === 7);
  assert.ok(resp && resp.result, '最终响应缺失');
  const idxResp = lines.indexOf(resp);
  assert.ok(lines.indexOf(progress[0]) < idxResp, '进度通知必须先于响应');
});

test('同批取消：同一 write 里的 cancelled 也必须生效（break-it 露馅②回归）', async () => {
  const lines = await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    const acc = [];
    const t = setTimeout(() => { p.kill(); reject(new Error('同批取消超时: ' + out.slice(0, 300))); }, 30000);
    p.stdout.on('data', (d) => {
      out += d.toString();
      let nl;
      while ((nl = out.indexOf('\n')) >= 0) {
        const s = out.slice(0, nl).trim();
        out = out.slice(nl + 1);
        if (!s) continue;
        try { acc.push(JSON.parse(s)); } catch { continue; }
        if (acc.some((m) => m.id === 8)) { clearTimeout(t); p.kill(); resolve(acc); return; }
      }
    });
    // 两行一次写入：读循环不许被 tools/call 的 await 卡住
    p.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'env_status', arguments: { only: 'M' } } }) + '\n' +
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 8, reason: 'batch' } }) + '\n'
    );
  });
  const resp = lines.find((m) => m.id === 8);
  assert.ok(resp, '没有响应');
  assert.equal(resp.error && resp.error.code, -32800, '同批取消必须回 -32800，而不是跑完返回结果');
});

test('进度总数不吃空段：only=00,,A 的 total 是 2（break-it 露馅③回归）', async () => {
  const lines = await callCollect('tools/call', { id: 9, name: 'env_status', arguments: { only: '00,,A', _meta: { progressToken: 'tok-2' } } });
  const progress = lines.filter((m) => m.method === 'notifications/progress');
  assert.equal(progress[0].params.total, 2, '空段不计入 total');
});

test('tool_discover 无参数返回全量清单，不回 matched:0（审计 P3-2 回归）', async () => {
  const lines = await callCollect('tools/call', { id: 11, name: 'tool_discover', arguments: {} });
  const resp = lines.find((m) => m.id === 11);
  const r = JSON.parse(resp.result.content[0].text);
  assert.ok(r.matched > 0, '无过滤条件时不该是空清单');
  assert.ok(r.tools.length === r.matched);
  assert.ok(typeof r.usage === 'string' && r.usage.includes('capability'), '注释说带 usage 就必须真带（审计 N6）');
});

test('取消处理在源码里在位：notifications/cancelled + -32800（审查建议 #13）', () => {
  const s = fs.readFileSync(SERVER, 'utf8');
  assert.ok(/notifications\/cancelled/.test(s), '缺 cancelled 处理');
  assert.ok(/-32800/.test(s), '缺 RequestCancelled 错误码');
  assert.ok(/inflight/.test(s), '缺在途请求表');
});
