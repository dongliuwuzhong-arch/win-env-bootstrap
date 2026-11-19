import { join } from 'node:path';
import { ok, warn, bad, info } from '../lib/report.js';

export const id = '00';
export const title = '人工前置（阶段一）';

// 这四件事脚本从不做，但缺了新电脑就跑不起来。
// 单独成段是为了让 agent 跑完一次就知道「还差哪几步人工」，
// 而不是从十几条警告里自己推断。
export async function check(ctx) {
  const out = [];
  const list = (ctx.manifest && ctx.manifest.prerequisites) || [];
  if (!list.length) { out.push(info('manifest 没有 prerequisites 清单')); return out; }

  const DSH_ROOT = ctx.DSH_ROOT;
  const profileNM = join(ctx.DSH_HOME, 'profiles', 'desktop', 'node_modules');
  const personaDir = join(ctx.WS || '', 'knowledge', 'persona');
  const skillsDir = join(ctx.WS || '', '.agents', 'skills');
  const cred = join(ctx.DSH_HOME, '.credentials.yaml');

  const state = {
    'dsh-host': Boolean(DSH_ROOT && ctx.exists(DSH_ROOT)),
    'dsh-home': ctx.exists(profileNM),
    'workspace': Boolean(ctx.WS) && ctx.exists(ctx.WS) && ctx.exists(skillsDir) && ctx.exists(personaDir),
    'credentials': ctx.exists(cred),
    'env': Boolean(process.env.DSH_WORKSPACE),
  };

  let blockingMissing = 0;
  for (const p of list) {
    const st = state[p.id];
    if (st === undefined) { out.push(info(p.title + '（未探测）')); continue; }
    if (st) { out.push(ok(p.title)); continue; }
    if (p.blocking) { blockingMissing++; out.push(bad(p.title + ' —— ' + p.why + '。做法：' + p.how)); }
    else out.push(info(p.title + '（可选）' + (p.why ? ' —— ' + p.why : '')));
  }

  if (blockingMissing > 0) {
    out.push(info('以上 ' + blockingMissing + ' 项人工前置未完成。它们不属于「本技能能修」的范围——本技能是阶段二。'));
  } else {
    out.push(ok('阶段一四项前置都到位，可以只看后面的阶段二检查'));
  }
  return out;
}
