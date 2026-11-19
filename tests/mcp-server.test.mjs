import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'scripts', 'mcp', 'server.mjs');

// 每次调用起一个干净的 server，发一条请求，拿第一行应答就杀。
function callOnce(method, params, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let settled = false;
    const finish = (fn, arg) => { if (settled) return; settled = true; clearTimeout(t); p.kill(); fn(arg); };
    const t = setTimeout(() => finish(reject, new Error('MCP 超时，输出: ' + out.slice(0, 200) + err.slice(0, 200))), timeoutMs);
    p.stdout.on('data', (d) => {
      out += d.toString();
      const nl = out.indexOf('\n');
      if (nl >= 0) {
        try { finish(resolve, JSON.parse(out.slice(0, nl))); }
        catch { finish(reject, new Error('非法 JSON: ' + out.slice(0, 200))); }
      }
    });
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('exit', (code) => finish(reject, new Error('server 退出 ' + code + ': ' + err.slice(0, 200))));
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) + '\n');
  });
}

const callTool = (name, args) => callOnce('tools/call', { name, arguments: args });

test('tool_resolve 拒绝注入字符并标 isError（审查一般 #5）', async () => {
  const msg = await callTool('tool_resolve', { name: 'foo&calc' });
  assert.equal(msg.result.isError, true, '非法字符 name 必须是失败调用');
});

test('tool_resolve 空 name 是失败调用', async () => {
  const msg = await callTool('tool_resolve', { name: '  ' });
  assert.equal(msg.result.isError, true);
});

test('env_status 坏段名标 isError，不再是「成功的 error 对象」（审查一般 #6）', async () => {
  const msg = await callTool('env_status', { only: 'ZZ' });
  assert.equal(msg.result.isError, true, '未知段必须是失败调用');
});

test('env_status only 含非法字符直接拒', async () => {
  const msg = await callTool('env_status', { only: 'A;calc' });
  assert.equal(msg.result.isError, true);
});

test('未知工具名是失败调用', async () => {
  const msg = await callTool('nope', {});
  assert.equal(msg.result.isError, true);
});

test('versionArgs: [] 的工具不把帮助首行当版本（建议 #10）', async () => {
  const msg = await callTool('tool_resolve', { name: '7z' });
  assert.notEqual(msg.result.isError, true, '合法 name 不该报错');
  const r = JSON.parse(msg.result.content[0].text);
  if (r.resolved) assert.equal(r.version, null, '7z 没有安全版本探针，version 必须是 null');
});

test('未安装工具三态都是 false（不是 error）', async () => {
  const msg = await callTool('tool_resolve', { name: 'zzznotatool99' });
  assert.notEqual(msg.result.isError, true, '查不到工具不是协议错误');
  const r = JSON.parse(msg.result.content[0].text);
  assert.equal(r.resolved, false);
  assert.equal(r.inPath, false);
  assert.equal(r.installedNotInPath, false);
});

test('tool_resolve 保留 pathDirs 回退与 installedNotInPath 状态（源锚点）', () => {
  const s = fs.readFileSync(SERVER, 'utf8');
  assert.ok(/pathDirs/.test(s) && /installedNotInPath/.test(s), 'pathDirs 回退（审查一般 #4）又丢了');
});
