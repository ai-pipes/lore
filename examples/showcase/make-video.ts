/**
 * Builds the demo video from `record-demo.ts` output: every LLM wait is squeezed into
 * WAIT_MS of fast-forward, the rest plays in real time. Needs ffmpeg.
 *
 *   npx tsx examples/showcase/make-video.ts [rawDir] [out.mp4]
 */
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const rawDir = resolve(process.argv[2] ?? join('examples', 'showcase', 'out', 'raw'));
const out = resolve(process.argv[3] ?? join('examples', 'showcase', 'out', 'lore-demo.mp4'));
const WAIT_MS = 1600;

const { frames, waits } = JSON.parse(readFileSync(join(rawDir, 'timeline.json'), 'utf8')) as {
  frames: { file: string; t: number }[];
  waits: { from: number; to: number }[];
};

/** Maps a wall-clock time to video time (ms), compressing every wait to WAIT_MS. */
function map(t: number): number {
  let shift = 0;
  for (const w of waits) {
    const len = w.to - w.from;
    if (len <= WAIT_MS) continue;
    if (t >= w.to) shift += len - WAIT_MS;
    else if (t > w.from) return t - frames[0].t - shift - (t - w.from) + ((t - w.from) / len) * WAIT_MS;
  }
  return t - frames[0].t - shift;
}

const lines: string[] = [];
for (let i = 0; i < frames.length; i++) {
  const next = i + 1 < frames.length ? map(frames[i + 1].t) : map(frames[i].t) + 1000;
  const dur = Math.max(0, next - map(frames[i].t)) / 1000;
  lines.push(`file '${join(rawDir, frames[i].file)}'`, `duration ${dur.toFixed(4)}`);
}
lines.push(`file '${join(rawDir, frames[frames.length - 1].file)}'`);
const list = join(rawDir, 'concat.txt');
writeFileSync(list, lines.join('\n') + '\n');

execFileSync(
  'ffmpeg',
  ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
    '-vf', 'scale=1920:1080:flags=lanczos,fps=30,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', out],
  { stdio: 'inherit' },
);
const total = map(frames[frames.length - 1].t) / 1000;
console.log(`${out}: ${total.toFixed(1)} s (waits: ${waits.map((w) => ((w.to - w.from) / 1000).toFixed(0) + 's').join(', ')})`);
