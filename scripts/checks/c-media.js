import fs from 'node:fs';
import path from 'node:path';
import { ok, warn } from '../lib/report.js';

export const id = 'C';
export const title = '媒体工具';

export async function check(ctx) {
  const out = [];
  if (ctx.run('ffmpeg', ['-version'])) out.push(ok('ffmpeg 可用'));
  else out.push(warn('ffmpeg 缺失（media-processor 需要）', 'winget install Gyan.FFmpeg'));

  if (ctx.run('ffprobe', ['-version'])) out.push(ok('ffprobe 可用'));
  else out.push(warn('ffprobe 缺失（取时长/分辨率要用）', 'winget install Gyan.FFmpeg'));

  const ytdlp = ctx.run('yt-dlp', ['--version']);
  if (ytdlp) out.push(ok('yt-dlp ' + ytdlp));
  else out.push(warn('yt-dlp 缺失（video-transcript-downloader 需要）'));

  // ImageMagick：convert 在 Windows 上会命中 C:\Windows\system32\convert.exe（磁盘转换工具），
  // image_*.py 的 fallback 会把图片参数喂给它 —— 不报错、跑错程序。必须查 magick。
  // 刚用 -Apply 加过 PATH 时当前进程的 PATH 还是旧快照，所以要有安装路径兜底。
  const magickV = ctx.run('magick', ['-version']);
  if (magickV) out.push(ok('ImageMagick (magick) 可用'));
  else {
    let magickExe = null;
    try {
      const pf = 'C:\\Program Files';
      if (ctx.exists(pf)) {
        for (const d of fs.readdirSync(pf)) {
          if (/^ImageMagick/i.test(d)) {
            const c = path.join(pf, d, 'magick.exe');
            if (ctx.exists(c)) { magickExe = c; break; }
          }
        }
      }
    } catch { }
    if (magickExe) out.push(ok('ImageMagick 已装（' + magickExe + '），但不在当前进程 PATH —— 重启 shell 后生效'));
    else {
      const convPath = ctx.run('where', ['convert']);
      if (convPath && /system32/i.test(convPath)) {
        out.push(warn('ImageMagick 缺失，convert 会命中系统磁盘工具 —— image_*.py 可能跑错程序（可选）', 'winget install ImageMagick.ImageMagick'));
      } else {
        out.push(warn('ImageMagick (magick) 缺失（image_*.py 需要）', 'winget install ImageMagick.ImageMagick'));
      }
    }
  }
  return out;
}
