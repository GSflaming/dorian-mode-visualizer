import { execFileSync } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../v2/model.mjs';
import { parseChord, theoreticalVoices } from '../vendor/dream-theater/theory.mjs';
export const root = fileURLToPath(new URL('../', import.meta.url));
export const tracks = resolve(root, '../assets/audio/tracks'),
  output = resolve(root, 'output/v2'),
  config = resolve(root, 'config/v2.json');
export const sha = (b) => createHash('sha256').update(b).digest('hex');
export async function hashFile(path) {
  const h = createHash('sha256');
  for await (const b of createReadStream(path)) h.update(b);
  return h.digest('hex');
}
export async function loadConfig(path) {
  const raw = await readFile(path);
  return {
    model: validate(JSON.parse(raw), JSON.parse(await readFile(resolve(root, 'config/v2.schema.json')))),
    configHash: sha(raw),
  };
}
export async function trackPath(dir, name) {
  if (!name || basename(name) !== name || /[\\:\x00-\x1f]/.test(name) || !/[.](wav|flac)$/i.test(name)) {
    throw Error('无效的素材文件名');
  }
  const file = await realpath(resolve(dir, name)).catch(() => {
    throw Error('缺少素材 ' + name);
  });
  if (dirname(file) !== await realpath(dir) || !(await stat(file)).isFile()) {
    throw Error('素材必须位于 tracks 目录');
  }
  return file;
}
export function decode(file, sourceMs, lengthMs) {
  const format = file.toLowerCase().endsWith('.flac') ? 'flac' : 'wav';
  const input = ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', format, '-i', file];
  const meta = JSON.parse(
    execFileSync('ffprobe', [
      ...input,
      '-select_streams',
      'a:0',
      '-show_entries',
      'stream=duration,sample_rate,channels',
      '-of',
      'json',
    ]),
  ).streams[0];
  if (
    !meta?.channels || !(Number(meta.duration) > 0) ||
    sourceMs + lengthMs > Number(meta.duration) * 1000 + 0.5 / 48
  ) throw Error('声道无效或录音时长不足 ' + file);
  const start = sourceMs * 48, end = (sourceMs + lengthMs) * 48;
  const raw = execFileSync('ffmpeg', [
    ...input,
    '-map',
    '0:a:0',
    '-af',
    `aresample=48000,atrim=start_sample=${start}:end_sample=${end + 384}`,
    '-ac',
    '2',
    '-f',
    'f32le',
    'pipe:1',
  ], { maxBuffer: (end - start + 1024) * 8 + 65536 });
  if (raw.length < (end - start) * 8) throw Error('解码样本不足 ' + file);
  return { samples: new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length)), meta };
}
export function synth(s) {
  const samples = new Float32Array((s.endMs - s.startMs) * 96);
  for (const h of s.harmony) {
    const tones = theoreticalVoices(parseChord(h.symbol)), len = (h.endMs - h.startMs) * 48;
    let filtered = 0;
    for (let i = 0; i < len; i++) {
      const t = i / 48000,
        env = (1 - Math.exp(-t * 75)) * (0.38 + 0.62 * Math.exp(-1.8 * t)) * Math.min(1, (len - i) / 2400);
      let sum = 0;
      for (const { midi } of tones) {
        const phase = 2 * Math.PI * 440 * 2 ** ((midi - 69) / 12) * t;
        sum += Math.sin(phase) + 0.27 * Math.exp(-2 * t) * Math.sin(phase * 2) + 0.1 * Math.sin(phase * 3);
      }
      filtered += 0.22 * (sum / tones.length - filtered);
      const at = ((h.startMs - s.startMs) * 48 + i) * 2;
      samples[at] = samples[at + 1] = filtered * env;
    }
  }
  return samples;
}
export function wav(samples) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(48000, 24);
  b.writeUInt32LE(192000, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(b.length - 44, 40);
  samples.forEach((v, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
  return b;
}
