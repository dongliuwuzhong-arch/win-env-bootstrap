#!/usr/bin/env node
/**
 * dsh-env-bootstrap / MCP server（只读三件套）
 *
 * 让 agent 直接发现「这台机器有什么工具、在哪、什么版本、缺什么会坏什么」，
 * 而不是靠人转述路径或自己 which。
 *
 * 传输：stdio，JSON-RPC 2.0，一行一条消息。
 * 只读：本 server 不安装、不修改、不写 PATH。写操作留给 bootstrap -Apply。
 *
 * 工具：
 *   env_status     全量体检结果（等价 verify.mjs --json）
 *   tool_discover  按 capability 查工具（如 media:probe -> ffprobe）
 *   tool_resolve   给工具名返回绝对路径 + 版本 + 是否在 PATH
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, '..');
const VERIFY = join(SCRIPTS, 'verify.mjs');

let manifest = null;
async function getManifest() {
  if (manifest) return manifest;
  const { loadManifest } = await import('../lib/paths.js');
  manifest = loadManifest();
  return manifest;
}

const TOOLS = [
  {
    name: 'env_status',
    description: '这台机器的环境体检结果：18 段（含人工前置）逐条状态、缺口计数、退出码。等价 verify.mjs --json。',
    inputSchema: {
      type: 'object',
      properties: {
        only: { type: 'string', description: '只跑指定段，逗号分隔，如 A,G2,00' },
      },
    },
  },
  {
    name: 'tool_discover',
    description: '按 capability 查工具。比如媒体探信息给 "media:probe"，文本搜索给 "text:search"。返回匹配的工具名、消费方、缺失后果。',
    inputSchema: {
      type: 'object',
      properties: {
        capability: { type: 'string', description: '能力标识，支持子串匹配' },
        keyword: { type: 'string', description: '按工具名/消费方/能力做模糊匹配' },
      },
    },
  },
  {
    name: 'tool_resolve',
    description: '给工具名返回绝对路径、版本、是否在 PATH。用 where/Get-Command 实测，不靠猜。',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: '工具名，如 ffmpeg / magick / rg' } },
      required: ['name'],
    },
  },
];

// isError 让 agent 按 MCP 规范把坏参数当失败调用，而不是成功返回了一个 error 对象（审查一般 #6）。
function text(s, isError) {
  const r = { content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 2) }] };
  if (isError) r.isError = true;
  return r;
}

async function callTool(name, args, msg) {
  const mf = await getManifest();
  if (name === 'env_status') {
    const only = args && args.only ? String(args.only) : '';
    if (only && !/^[A-Za-z0-9,]+$/.test(only)) return text({ error: 'only 只能是段 id，逗号分隔（如 A,G2,00）' }, true);
    // 一律走异步子进程 + --jsonl：spawnSync 会卡死事件循环，取消永远排不上队
    // （break-it 露馅② 的根因——无 progressToken 的请求不可取消）。
    // progressToken 只决定发不发 notifications/progress。
    const token = args && args._meta && args._meta.progressToken;
    const wantProgress = token !== undefined && token !== null;
    return new Promise((resolve) => {
      // slot 在读循环里就已注册——cancel 可能比 spawn 先到（同 chunk 就是这个次序）
      const slot = inflight.get(msg.id) || { cancelled: false, child: null };
      inflight.set(msg.id, slot);
      if (slot.cancelled) { inflight.delete(msg.id); resolve({ __rpcError: { code: -32800, message: 'request cancelled' } }); return; }
      const child = spawn(process.execPath, [VERIFY, '--jsonl', ...(only ? ['--only=' + only] : [])]);
      child.killed = false;
      child.timedOut = false;
      // 自管超时：spawn 的 timeout 会 kill 并让 killed=true，跟用户取消混成一谈（code-audit #4）
      const timer = setTimeout(() => { child.timedOut = true; killTree(child); }, 600000);
      slot.child = child;
      let buf = '';
      let errBuf = '';
      let done = null;
      let segs = 0;
      child.stderr.on('data', (d) => { errBuf += d.toString(); });
      // 总数与 verify 同口径：去空段、去重、大小写归一（露馅③ + code-audit #7）
      const uniq = only ? [...new Set(only.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean))] : null;
      const total = uniq ? uniq.length : 18;
      child.stdout.on('data', (d) => {
        buf += d.toString();
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const lineStr = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!lineStr) continue;
          let j;
          try { j = JSON.parse(lineStr); } catch { continue; }
          if (j.type === 'segment') {
            segs++;
            if (wantProgress) notify('notifications/progress', { progressToken: token, progress: segs, total, data: j });
          } else if (j.type === 'done') {
            const { type, ...payload } = j;
            done = payload;
          }
        }
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        inflight.delete(msg.id);
        // 超时、取消、崩溃是三件不同的事，不许都叫 cancelled（code-audit #4）
        if (child.timedOut) { resolve(text({ error: 'verify 超时（600s）——不是取消，是真跑不完', exitCode: code }, true)); return; }
        if (child.killed || slot.cancelled) { resolve({ __rpcError: { code: -32800, message: 'request cancelled' } }); return; }
        if (done) resolve(text(done));
        else {
          // 真因多半在 stderr（如「未知检查段: ZZ」），别让泛化错误把它埋了（露馅④）
          const firstErr = errBuf.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0];
          resolve(text({ error: firstErr || 'verify 输出异常', exitCode: code }, true));
        }
      });
    });
  }
  if (name === 'tool_discover') {
    const cap = (args && args.capability) ? String(args.capability).toLowerCase() : '';
    const kw = (args && args.keyword) ? String(args.keyword).toLowerCase() : '';
    const all = (mf && mf.tools) || [];
    // 无过滤条件时返回全量并带 usage，别回一个 matched:0 让人以为清单是空的（审计 P3-2）
    const hit = (!cap && !kw) ? all : all.filter((t) => {
      const capHit = cap && String(t.capability || '').toLowerCase().includes(cap);
      const kwHit = kw && [t.name, t.consumer, t.capability, t.degradedBehavior].some((x) => String(x || '').toLowerCase().includes(kw));
      return capHit || kwHit;
    });
    return text({
      matched: hit.length,
      // 注释说了带 usage 就真的带（审计 N6：注释不许虚标）
      ...(cap || kw ? {} : { usage: '用 capability 或 keyword 过滤，如 {"capability":"media:probe"}' }),
      tools: hit.map((t) => ({ name: t.name, capability: t.capability, consumer: t.consumer, degradedBehavior: t.degradedBehavior, install: t.winget || (t.pip && ('pip ' + t.pip)) || (t.npm && ('npm ' + t.npm)) || null })),
    });
  }
  if (name === 'tool_resolve') {
    const n = String((args && args.name) || '').trim();
    if (!n) return text({ error: 'name 必填' }, true);
    // 注入面收口：name 会进 cmd /c。字符白名单 + 只执行 where / manifest pathDirs
    // 解析出的路径，绝不执行原始输入（审查一般 #5）。
    if (!/^[A-Za-z0-9._-]+$/.test(n)) return text({ error: 'name 含非法字符（只允许字母数字 . _ -）' }, true);
    const tool = ((mf && mf.tools) || []).find((t) => t.name === n);
    const probeCmd = (tool && (tool.probeCmd || tool.name)) || n;
    const probeArgs = (tool && (tool.probeArgs !== undefined ? tool.probeArgs : tool.versionArgs)) || ['--version'];
    // 不用 shell+args（DEP0190：参数不转义）。where 是 exe，直接调。
    const r = spawnSync('where', [probeCmd], { encoding: 'utf8', timeout: 15000 });
    const inPathPath = (r.stdout || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0] || null;
    // 「装了但不在 PATH」是本工具存在的头号理由：where 没命中就回退查 manifest 的
    // pathDirs（7-Zip 经典坑），否则已安装会被误报成未安装（审查一般 #4）。
    let found = inPathPath;
    let installedNotInPath = false;
    if (!found && tool && Array.isArray(tool.pathDirs)) {
      const exeName = tool.exeName || (probeCmd + '.exe');
      for (const d of tool.pathDirs) {
        const cand = join(d, exeName);
        try { if (existsSync(cand)) { found = cand; installedNotInPath = true; break; } } catch { /* keep probing */ }
      }
    }
    let version = null;
    // versionArgs: [] 表示没有安全的版本探针（7z 把帮助首行当版本）——跳过（建议 #10）。
    if (found && Array.isArray(probeArgs) && probeArgs.length > 0) {
      // 走 cmd /c 是为了让 .cmd 也能跑（node 直接 spawn 不了批处理）。执行的是
      // where / pathDirs 解析出的绝对路径，不是用户输入。
      const v = spawnSync('cmd', ['/c', found, ...probeArgs], { encoding: 'utf8', timeout: 15000 });
      version = ((v.stdout || '') + (v.stderr || '')).split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0] || null;
    }
    return text({
      name: n,
      resolved: Boolean(found),
      inPath: Boolean(inPathPath),
      installedNotInPath,
      path: found,
      version,
      capability: tool ? tool.capability : null,
      consumer: tool ? tool.consumer : null,
      degradedBehavior: tool ? tool.degradedBehavior : null,
      installHint: tool ? (tool.winget || (tool.pip && ('pip install ' + tool.pip)) || (tool.npm && ('npm i ' + tool.npm)) || null) : null,
    });
  }
  return text({ error: 'unknown tool: ' + name }, true);
}

// ---------- JSON-RPC over stdio ----------
function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}
function replyErr(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}
function notify(method, params) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}
function killTree(child) {
  // child.kill() 在 Windows 是 TerminateProcess，只杀 verify 自己，它内部的
  // PowerShell 探针会继续跑完——taskkill /T 连整棵进程树一起收（code-audit #5）
  try { spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f']); } catch { /* best effort */ }
  try { child.kill(); } catch { /* already gone */ }
}
// 在途请求表：notifications/cancelled 用它找到子进程并掐断（MCP 取消规范）
const inflight = new Map();

let buf = '';
process.stdin.on('data', async (chunk) => {
  buf += chunk.toString('utf8');
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    try {
      if (msg.method === 'initialize') {
        reply(msg.id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'dsh-env-bootstrap', version: '1.0.0' },
        });
      } else if (msg.method === 'tools/list') {
        reply(msg.id, { tools: TOOLS });
      } else if (msg.method === 'tools/call') {
        // 不 await：读循环必须立刻回到下一行，否则同一 chunk 里排在后面的
        // notifications/cancelled 要等请求跑完才被处理——同批取消会确定性丢失（露馅②）。
        // slot 先于 spawn 注册：cancel 可能赶在子进程创建之前到。
        inflight.set(msg.id, { cancelled: false, child: null });
        Promise.resolve(callTool(msg.params && msg.params.name, (msg.params && msg.params.arguments) || {}, msg)).then((out) => {
          inflight.delete(msg.id);
          if (out && out.__rpcError) replyErr(msg.id, out.__rpcError.code, out.__rpcError.message);
          else reply(msg.id, out);
        }).catch((e) => { inflight.delete(msg.id); replyErr(msg.id, -32603, String((e && e.message) || e)); });
      } else if (msg.method === 'notifications/cancelled') {
        const rid = msg.params && msg.params.requestId;
        const slot = inflight.get(rid);
        if (slot) {
          slot.cancelled = true;
          if (slot.child) { slot.child.killed = true; killTree(slot.child); }
        }
      } else if (msg.method === 'notifications/initialized') {
        // no reply for notifications
      } else if (msg.id !== undefined) {
        replyErr(msg.id, -32601, 'method not found: ' + msg.method);
      }
    } catch (e) {
      if (msg.id !== undefined) replyErr(msg.id, -32603, String(e && e.message || e));
    }
  }
});
// SIGTERM / stdin 关闭都先把在途 verify 子进程树收掉再退（审计 P3-7）
function shutdown() {
  for (const slot of inflight.values()) {
    if (slot && slot.child) { slot.child.killed = true; killTree(slot.child); }
  }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.stdin.on('end', shutdown);
