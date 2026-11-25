import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { spawn } from 'node:child_process';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createV2Stage, HEIGHT, WIDTH } from '../v2-stage.mjs';
import { config, hashFile, loadConfig, output, sha, trackPath, tracks } from './v2-audio.mjs';
export async function render(args, dir, cfg, assetDir) {
  const { model, configHash } = await loadConfig(cfg);
  const manifest = JSON.parse(await readFile(resolve(dir, 'manifest.json')));
  const bytes = await readFile(resolve(dir, 'features.json')), audio = resolve(dir, 'master.wav');
  if (
    manifest.configHash !== configHash || sha(bytes) !== manifest.featuresHash ||
    await hashFile(audio) !== manifest.masterHash
  ) throw Error('配置或母版已变动，请重新 prepare');
  const checked = new Set();
  for (const s of manifest.sources.filter((s) => s.file)) {
    if (checked.has(s.file)) continue;
    const file = await trackPath(assetDir, s.file);
    if (await hashFile(file) !== s.sha256) throw Error('录音已变动 ' + s.file + '，请重新 prepare');
    checked.add(s.file);
  }
  const font = process.env.DORIAN_FONT ??
    (process.platform === 'darwin' ? '/System/Library/Fonts/Hiragino Sans GB.ttc' : null);
  if (font && !GlobalFonts.registerFromPath(font, 'Hiragino Sans GB')) {
    throw Error('无法加载中文字体 ' + font);
  }
  if (process.platform === 'darwin') {
    GlobalFonts.registerFromPath('/System/Library/Fonts/Apple Symbols.ttf', 'Apple Symbols');
  }
  const canvas = createCanvas(WIDTH, HEIGHT), draw = createV2Stage(model, JSON.parse(bytes), canvas);
  const scene = model.scenes.find((s) => s.id === args.scene);
  if (args.scene && !scene) throw Error('未知场景 ' + args.scene);
  const options = { theme: args.theme ?? 'light' };
  if (!['light', 'dark'].includes(options.theme)) throw Error('未知主题');
  if (args.layers !== undefined) {
    const keys = ['waveform', 'chroma', 'reference', 'cues'],
      selected = args.layers.split(',').filter(Boolean);
    if (selected.some((k) => !keys.includes(k))) throw Error('未知分析层');
    for (const k of keys) options[k] = selected.includes(k);
  }
  const start = scene?.startMs ?? 0, end = scene?.endMs ?? model.durationMs;
  if (args['snapshot-ms'] !== undefined) {
    const ms = Number(args['snapshot-ms']);
    if (!Number.isFinite(ms) || ms < start || ms >= end) throw Error('静帧时间越界');
    draw(ms, options);
    const file = resolve(dir, 'snapshot-' + ms + '.png');
    await writeFile(file, canvas.toBuffer('image/png'));
    console.log(file);
  } else {
    const file = resolve(dir, scene ? 'scene-' + scene.id + '.mp4' : 'Dorian-V2.mp4'),
      temp = file + '.' + process.pid + '.mp4';
    const encoder = spawn('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'image2pipe',
      '-framerate',
      String(model.fps),
      '-c:v',
      'mjpeg',
      '-i',
      'pipe:0',
      '-i',
      audio,
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-af',
      `atrim=start_sample=${start * 48}:end_sample=${end * 48},asetpts=PTS-STARTPTS`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '17',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '320k',
      '-movflags',
      '+faststart',
      temp,
    ], { stdio: ['pipe', 'ignore', 'inherit'] });
    let error;
    encoder.on('error', (e) => {
      error = e;
    });
    encoder.stdin.on('error', (e) => {
      error = e;
    });
    const done = new Promise((ok) => encoder.once('close', ok));
    try {
      for (let n = 0; n < Math.ceil((end - start) * model.fps / 1000); n++) {
        if (error || encoder.exitCode !== null) throw error ?? Error('编码器退出');
        draw(start + n * 1000 / model.fps, options);
        await new Promise((ok, fail) =>
          encoder.stdin.write(canvas.toBuffer('image/jpeg', 95), (e) => e ? fail(e) : ok())
        );
      }
      encoder.stdin.end();
      if (await done !== 0 || error) throw error ?? Error('编码失败');
      await rename(temp, file);
      console.log(file);
    } finally {
      encoder.kill();
      await done;
      await rm(temp, { force: true });
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values: args } = parseArgs({
    options: {
      scene: { type: 'string' },
      'snapshot-ms': { type: 'string' },
      demo: { type: 'boolean' },
      'study-demo': { type: 'boolean' },
      theme: { type: 'string' },
      layers: { type: 'string' },
    },
  });
  const variant = args['study-demo'] ? 'part2-demo' : args.demo ? 'demo' : null;
  const dir = variant ? resolve(output, variant) : output;
  await render(args, dir, variant ? resolve(dir, 'v2.json') : config, variant ? resolve(dir, 'tracks') : tracks);
}
