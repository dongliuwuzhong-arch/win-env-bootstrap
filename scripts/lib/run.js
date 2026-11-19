/**
 * 子进程封装：ENOENT / 非零退出 / 超时的语义都在这里，check 不用各自 try。
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

export function run(exe, args, opts = {}) {
  // Windows 上 .cmd/.bat 不能直接 execFile：走 cmd.exe /c 显式解释。
  // 不用 shell:true —— 那会带参数触发 DEP0190 警告，把 stderr 灌进报告。
  const isCmd = /\.(cmd|bat)$/i.test(exe);
  const file = isCmd ? 'cmd.exe' : exe;
  const argv = isCmd ? ['/d', '/s', '/c', exe, ...args] : args;
  try {
    return execFileSync(file, argv, {
      encoding: 'utf8', timeout: opts.timeout || 30000,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isCmd ? false : (opts.shell ?? false),
      env: { ...process.env, ...(opts.env || {}) },
    }).trim();
  } catch (e) {
    // 区分「真的没这个程序」和「装了但非零退出/超时」——后者不能报"未安装"
    if (e && (e.code === 'ENOENT' || e.code === 'EACCES')) { return null; }
    const out = ((e && e.stdout) || '').trim();
    if (out) return out;               // 有输出就当拿到了（版本号常在非零退出里也有）
    return null;
  }
}

export function runNode(args, opts = {}) {
  return run(process.execPath, args, opts);
}

export function exists(p) { try { return fs.existsSync(p); } catch { return false; } }

export function firstExisting(list) { return list.find(exists) || null; }

// 同一个外部查询只跑一次：多段共用的探测都走它
export function memo(fn) {
  let done = false;
  let val;
  return (...args) => {
    if (!done) { val = fn(...args); done = true; }
    return val;
  };
}