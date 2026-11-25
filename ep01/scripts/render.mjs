import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chrome } from './chrome.mjs';
import { root, serve } from './serve.mjs';
import { compile, HEIGHT, RATE, trackClip, WIDTH } from '../timeline.mjs';

const { values: args } = parseArgs({ options: {
  scene: { type: 'string', multiple: true }, output: { type: 'string' }, config: { type: 'string' },
  notes: { type: 'string' }, 'audio-dir': { type: 'string' }, 'require-audio': { type: 'boolean' },
} });
const load = async (path) => JSON.parse(await readFile(path, 'utf8'));
const project = await load(args.config ?? resolve(root, 'config/scenes.json'));
const recordings = await load(args.notes ?? resolve(root, 'config/notes.json'));
const model = compile(project, recordings, args.scene);
const output = resolve(args.output ?? resolve(root, 'exports', `${args.scene?.join('-') ?? 'EP01'}-v0.1.mp4`));
const temporary = output + `.part-${process.pid}.mp4`;
const audioDir = resolve(args['audio-dir'] ?? resolve(root, 'assets/audio'));
const inputs = [];
const filters = [];
const assets = {};
const missing = [];
const samples = (seconds) => Math.round(seconds * RATE);

for (const scene of model.scenes) {
  for (const track of scene.tracks) {
    const path = resolve(audioDir, track.file);
    const label = `${scene.id} ${track.file}`;
    try {
      await stat(path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing.push(label + ' 缺失');
      continue;
    }
    const { streams: [stream] } = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0',
      '-show_entries', 'stream=duration,channels,codec_name', '-of', 'json', path], { encoding: 'utf8' }));
    if (!stream?.codec_name.startsWith('pcm_') || ![1, 2].includes(stream.channels) || !(Number(stream.duration) > 0)) {
      throw new Error(`${label} 需要单声道或立体声 PCM WAV`);
    }
    const asset = { duration: Number(stream.duration) };
    assets[track.key] = asset;
    const clip = trackClip(track, scene, asset.duration);
    if (clip.end + .025 < (track.until ?? scene.duration)) missing.push(label + ' 时长不足');
    const length = samples(clip.end - clip.start);
    if (length <= 0) continue;
    const delay = samples(scene.startFrame / model.fps + clip.start);
    const index = inputs.length + 1;
    inputs.push(path);
    const pan = stream.channels === 1 ? ',pan=stereo|c0=c0|c1=c0' : '';
    const startSample = samples(clip.offset);
    filters.push(`[${index}:a]aresample=${RATE}${pan},atrim=start_sample=${startSample}:end_sample=${startSample + length},asetpts=N/SR/TB,volume=${track.gain},adelay=${delay}S:all=1[a${index}]`);
  }
}
if (missing.length) console.log(missing.join('\n'));
if (args['require-audio'] && missing.length) throw new Error('必需实录 WAV 尚未就绪');

const mix = inputs.length ? [
  '-filter_complex', filters.concat(inputs.map((_, i) => `[a${i + 1}]`).join('') +
    `amix=inputs=${inputs.length}:normalize=0,apad=whole_len=${samples(model.duration)},atrim=end_sample=${samples(model.duration)},asetpts=N/SR/TB[mix]`).join(';'),
  '-map', '[mix]', '-c:a', 'aac', '-b:a', '256k',
] : [];
const encoderArgs = ['-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'image2pipe', '-framerate', String(model.fps), '-c:v', 'mjpeg', '-i', 'pipe:0',
  ...inputs.flatMap(path => ['-i', path]), '-map', '0:v:0', ...mix, '-c:v', 'libx264',
  '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p',
  '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
  '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', temporary];
let browser;
let local;
let encoder;
let encoderDone;
try {
  await mkdir(dirname(output), { recursive: true });
  local = await serve();
  browser = await chrome();
  await browser.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  await browser.send('Page.navigate', { url: local.url + 'stage.html' });
  for (let i = 0; !await browser.evaluate('Boolean(window.ep01)'); i++) {
    if (i >= 100) throw new Error('渲染画布载入超时');
    await new Promise(done => setTimeout(done, 100));
  }
  await browser.evaluate(`document.fonts.ready.then(() => ep01.init(${JSON.stringify(project)},${JSON.stringify(recordings)},${JSON.stringify(args.scene ?? null)},${JSON.stringify(assets)}))`);

  encoder = spawn('ffmpeg', encoderArgs, { stdio: ['pipe', 'ignore', 'inherit'] });
  encoder.stdin.on('error', () => {});
  encoderDone = once(encoder, 'close');
  encoderDone.catch(() => {});
  const batchSize = 12;
  for (let start = 0; start < model.frames; start += batchSize) {
    const count = Math.min(batchSize, model.frames - start);
    const batch = await browser.evaluate(`ep01.images(${start},${count})`);
    const bytes = Buffer.concat(batch.map(value => Buffer.from(value, 'base64')));
    if (encoder.stdin.destroyed) throw new Error('FFmpeg 已停止接收画面');
    await new Promise((ok, fail) => encoder.stdin.write(bytes, error => error ? fail(error) : ok()));
    if ((start + count) % 600 === 0 || start + count === model.frames) console.log(`${start + count}/${model.frames} 帧`);
  }
  encoder.stdin.end();
  const [code] = await encoderDone;
  if (code !== 0) throw new Error('FFmpeg 编码失败');
  await rename(temporary, output);
  console.log(output);
} finally {
  if (encoder && encoder.exitCode === null) {
    encoder.kill();
    await encoderDone?.catch(() => {});
  }
  await browser?.close();
  local?.server.close();
  await rm(temporary, { force: true });
}
