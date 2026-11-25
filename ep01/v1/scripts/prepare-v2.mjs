import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { analyze } from '../v2/dsp.mjs';
import {
  config,
  decode,
  hashFile,
  loadConfig,
  output,
  root,
  sha,
  synth,
  trackPath,
  tracks,
  wav,
} from './v2-audio.mjs';
export async function prepare(cfg = config, dir = tracks, out = output, backend = 'node', studyEvents) {
  const { model, configHash } = await loadConfig(cfg);
  await mkdir(out, { recursive: true });
  const lock = resolve(out, '.preparing');
  await mkdir(lock);
  let tmp;
  try {
    tmp = await mkdtemp(resolve(out, '.build-'));
    const master = new Float32Array(model.durationMs * 96), sources = [], hashes = new Map();
    let tail;
    for (const s of model.scenes) {
      const len = (s.endMs - s.startMs) * 48;
      let samples, metadata = { kind: 'soft-piano' };
      if (s.audio) {
        const file = await trackPath(dir, s.audio.file);
        const { samples: raw, meta } = decode(file, s.audio.sourceInMs, len / 48);
        samples = raw;
        if (!hashes.has(file)) hashes.set(file, await hashFile(file));
        metadata = {
          ...s.audio,
          sha256: hashes.get(file),
          channels: meta.channels,
          sampleRate: Number(meta.sample_rate),
        };
      } else samples = synth(s);
      let energy = 0, peak = 0;
      for (let i = 0; i < samples.length; i++) {
        peak = Math.max(peak, Math.abs(samples[i]));
        if (i < len * 2) energy += samples[i] ** 2;
      }
      const gain = Math.min(
        0.126 / Math.max(1e-9, Math.sqrt(energy / (len * 2))),
        0.794 / Math.max(1e-9, peak),
      );
      const fade = Math.min(384, len), base = s.startMs * 96;
      const controlled = s.view === 'compare_ab' && !s.audio;
      if (controlled) {
        for (let j = 1; j <= Math.min(384, base / 2); j++) {
          master[base - 2 * j] *= j / 384;
          master[base - 2 * j + 1] *= j / 384;
        }
      }
      for (let i = 0; i < len * 2; i++) {
        const frame = i >> 1, weight = controlled ? 1 : Math.min(1, frame / fade), channel = i % 2;
        // Outgoing post-roll stays on its own source clock; at EOF hold the last sample.
        const prev = tail?.[Math.min(i - channel, (tail?.length ?? 2) - 2) + channel] ?? 0;
        master[base + i] = (prev * (1 - weight) + samples[i] * gain * weight) *
          (controlled ? 1 : Math.min(1, (model.durationMs * 48 - base / 2 - frame) / 384));
      }
      tail = samples.slice(Math.min(len * 2, samples.length - 2)).map((v) => v * gain);
      sources.push({ id: s.id, startMs: s.startMs, endMs: s.endMs, sampleCount: len, gain, ...metadata });
    }
    const bytes = wav(master), masterPath = resolve(tmp, 'master.wav');
    await writeFile(masterPath, bytes);
    const pcm = await readFile(masterPath),
      left = new Float32Array(master.length / 2),
      right = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) {
      left[i] = pcm.readInt16LE(44 + 4 * i) / 32768;
      right[i] = pcm.readInt16LE(46 + 4 * i) / 32768;
    }
    const features = analyze(left, right, 48000, model.fps);
    if (backend === 'librosa') {
      try {
        const result = JSON.parse(
          execFileSync('python3', [resolve(root, 'scripts/v2-chroma.py'), masterPath, String(model.fps)], {
            maxBuffer: 64 * 1024 * 1024,
          }),
        );
        if (result.length !== features.frames.length) throw Error('CQT 帧数不符');
        features.frames.forEach((f, i) => {
          f.chroma = result[i];
        });
      } catch (error) {
        if (error.code !== 'ENOENT' && !String(error.stderr).includes('ModuleNotFoundError')) throw error;
        console.warn('缺少 Python 音频依赖，使用 Node FFT');
        backend = 'node';
      }
    } else if (backend !== 'node') throw Error('未知 DSP 后端');
    const json = JSON.stringify(studyEvents ? { ...features, studyEvents } : features);
    const manifest = {
      configHash,
      masterHash: sha(bytes),
      featuresHash: sha(json),
      backend,
      fps: model.fps,
      sampleRate: 48000,
      sampleCount: left.length,
      sources,
    };
    await writeFile(resolve(tmp, 'features.json'), json);
    await writeFile(resolve(tmp, 'manifest.json'), JSON.stringify(manifest, null, 2));
    for (const name of ['master.wav', 'features.json', 'manifest.json']) {
      await rename(resolve(tmp, name), resolve(out, name));
    }
    return manifest;
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true });
    await rm(lock, { recursive: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await prepare(config, tracks, output, process.env.DORIAN_CHROMA ?? 'node');
  console.log(output);
}
