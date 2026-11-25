import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createCanvas } from '@napi-rs/canvas';
import { analyze } from '../v2/dsp.mjs';
import { createV2Stage } from '../v2-stage.mjs';
import { prepare } from '../scripts/prepare-v2.mjs';
import { fixture } from '../scripts/v2-fixture.mjs';
import { decode, trackPath, wav } from '../scripts/v2-audio.mjs';
import { render } from '../scripts/render-v2.mjs';
const temp = async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dorian-v2-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
};
test('stereo spectral peaks distinguish C, C sharp, Em7 and A7 at 30/60 fps', () => {
  for (const notes of [[60], [61], [52, 55, 59, 62], [45, 55, 61, 64]]) {
    for (const fps of [30, 60]) {
      const left = Float32Array.from(
        { length: 24000 },
        (_, i) =>
          notes.reduce(
            (v, n) => v + 0.1 * Math.sin(2 * Math.PI * 440 * 2 ** ((n - 69) / 12) * i / 48000),
            0,
          ),
      );
      const features = analyze(
          left,
          left.map((x) => -x),
          48000,
          fps,
        ),
        frame = features.frames[Math.round(fps / 4)];
      assert.equal(features.frames.length, fps / 2);
      const pcs = frame.chroma.map((value, i) => [value, i]).sort((a, b) => b[0] - a[0]).slice(
        0,
        notes.length,
      ).map((a) => a[1]);
      assert.deepEqual(new Set(pcs), new Set(notes.map((n) => n % 12)));
      assert.ok(frame.rms > 0 && frame.bands.some((x) => x > 0) && features.waveform.length === 100);
    }
  }
});
test('48 kHz trim and scene placement preserve isolated impulses down to the sample', async (t) => {
  const dir = await temp(t), model = await fixture(dir, 60), s = model.scenes[0];
  const pcm = new Float32Array(2600 * 96),
    anchors = [111 * 48 + 3, 879 * 48 + 37, 2150 * 48 + 15],
    start = s.audio.sourceInMs * 48;
  for (const n of anchors) pcm[2 * (start + n)] = 0.7;
  await writeFile(join(dir, 'tracks', 'pulse.wav'), wav(pcm));
  s.audio.file = 'pulse.wav';
  s.audioMode = 'compare_audio'; // Explicit recording takes precedence over the piano.
  model.scenes = [s, { ...s, id: 'second', startMs: s.endMs, endMs: s.endMs * 2, harmony: [], cues: [] }];
  model.durationMs = s.endMs * 2;
  const second = model.scenes[1], cuts = [0, 111, 879, 2150, s.endMs];
  second.harmony = ['Em7', 'A7', 'Cmaj7', 'A7'].map((symbol, i) => ({
    startMs: second.startMs + cuts[i],
    endMs: second.startMs + cuts[i + 1],
    symbol,
    mode: null,
  }));
  const cfg = join(dir, 'v2.json');
  await writeFile(cfg, JSON.stringify(model));
  await prepare(cfg, join(dir, 'tracks'), dir);
  const bytes = await readFile(join(dir, 'master.wav'));
  const peaks = [];
  for (let i = 44; i < bytes.length; i += 4) {
    if (Math.abs(bytes.readInt16LE(i)) > 100) peaks.push((i - 44) / 4);
  }
  assert.deepEqual(peaks, [...anchors, ...anchors.map((n) => n + s.endMs * 48)]);
  const file = join(dir, 'tracks', 'pulse.wav');
  assert.throws(() => decode(file, 1000, 5000), /不足/);
  const flac = join(dir, 'tracks', 'mono.flac');
  execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ar', '44100', '-ac', '1', flac]);
  const decoded = decode(flac, 137, 2237);
  assert.equal(decoded.meta.channels, 1);
  assert.equal(decoded.meta.sample_rate, '44100');
  for (const n of anchors) {
    assert.ok(Array.from(decoded.samples.slice((n - 1) * 2, (n + 2) * 2)).some((v) => v > 0.1));
  }
  await assert.rejects(trackPath(join(dir, 'tracks'), '../pulse.wav'));
  await symlink(cfg, join(dir, 'tracks', 'escape.wav'));
  await assert.rejects(trackPath(join(dir, 'tracks'), 'escape.wav'));
  // Decode the actual non-frame-aligned scene export. Locate three sharp AAC
  // attacks and check both media timestamps, not just the encoder arguments.
  await render({ scene: 'second' }, dir, cfg, join(dir, 'tracks'));
  const mp4 = join(dir, 'scene-second.mp4');
  const raw = execFileSync('ffmpeg', [
    '-v',
    'error',
    '-i',
    mp4,
    '-map',
    '0:a',
    '-f',
    's16le',
    '-ac',
    '1',
    'pipe:1',
  ], { maxBuffer: 2000000 });
  for (const n of anchors) {
    let peak = 0, index = 0;
    for (let i = n - 1600; i < n + 1600; i++) {
      const v = Math.abs(raw.readInt16LE(i * 2));
      if (v > peak) {
        peak = v;
        index = i;
      }
    }
    assert.ok(peak > 1000);
    assert.ok(Math.abs(index - n) <= 48000 / 60);
  }
  // Inspect the encoded C-sharp key itself. Its fill must change on the
  // first sampled video frame at or after each audio impulse.
  const pixels = execFileSync('ffmpeg', [
    '-v',
    'error',
    '-i',
    mp4,
    '-an',
    '-vf',
    'crop=2:2:1160:702,format=rgb24',
    '-f',
    'rawvideo',
    'pipe:1',
  ]);
  const isRed = (n) => pixels[n * 12] - pixels[n * 12 + 1] > 65;
  const changes = [];
  for (let n = 1; n < pixels.length / 12; n++) if (isRed(n) !== isRed(n - 1)) changes.push(n);
  assert.equal(changes.length, anchors.length);
  changes.forEach((n, i) => assert.ok(Math.abs(n / 60 - anchors[i] / 48000) <= 1 / 60));
  const streams =
    JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', mp4])).streams;
  assert.equal(+streams[0].nb_frames, Math.ceil(s.endMs * 60 / 1000));
  assert.equal(streams[0].width, 1920);
  assert.equal(streams[0].height, 1080);
  assert.ok(Math.abs(+streams[1].duration - s.endMs / 1000) < 1 / 48000);
  assert.ok(streams.every((v) => +v.start_time === 0));
});
test('four layouts, all anatomy variants, both themes and half-open scene/cue boundaries', async (t) => {
  const dir = await temp(t), m = await fixture(dir), cfg = join(dir, 'v2.json');
  await prepare(cfg, join(dir, 'tracks'), dir);
  const features = JSON.parse(await readFile(join(dir, 'features.json'))),
    draw = createV2Stage(m, features, createCanvas(1920, 1080));
  for (const s of m.scenes) {
    assert.deepEqual(s.notes, []);
    assert.deepEqual(s.bars, []);
    for (
      const anatomy of s.view === 'theory_anatomy' ? ['gravity', 'tritone', 'center', 'scale'] : ['scale']
    ) {
      s.anatomy = anatomy;
      for (const theme of ['light', 'dark']) {
        for (const ms of [s.startMs, (s.startMs + s.endMs) / 2, s.endMs - 0.01]) {
          const boxes = [];
          const state = draw(ms, {
            theme,
            onText: (b) => boxes.push(b),
          });
          assert.equal(state.scene, s.id);
          for (const [i, b] of boxes.entries()) {
            assert.ok(b.x >= 0 && b.x + b.width <= 1920 && b.y - b.height >= 0 && b.y <= 1080, b.text);
            for (const a of boxes.slice(0, i)) {
              assert.ok(
                a.x + a.width <= b.x || b.x + b.width <= a.x || a.y <= b.y - b.height ||
                  b.y <= a.y - a.height,
                a.text + ' / ' + b.text,
              );
            }
          }
        }
      }
    }
  }
  assert.equal(draw(735.999).chord, 'Em7');
  assert.equal(draw(736).chord, 'A7');
  assert.equal(draw(1489).chord, 'Cmaj7');
  assert.equal(draw(0).cue, m.scenes[0].cues[0].line1);
  assert.equal(draw(2237).cue, undefined);
});
test('invalid edits and missing media preserve the previous prepared master', async (t) => {
  const dir = await temp(t),
    model = await fixture(dir),
    cfg = join(dir, 'v2.json'),
    assets = join(dir, 'tracks');
  const manifest = await prepare(cfg, assets, dir);
  for (
    const [edit, pattern] of [
      [(m) => m.scenes[0].endMs += 0.5, /字段/],
      [(m) => m.scenes[0].harmony[1].startMs--, /重叠/],
      [(m) => m.scenes[0].audio.file = '../outside.wav', /字段/],
      [(m) => delete m.scenes[0].audio, /缺少录音/],
      [(m) => m.scenes[0].audio.file = 'absent.wav', /缺少素材/],
      [(m) => m.scenes[1].harmony[1].symbol = 'B7', /C♮/],
    ]
  ) {
    const copy = structuredClone(model);
    edit(copy);
    await writeFile(cfg, JSON.stringify(copy));
    await assert.rejects(prepare(cfg, assets, dir), pattern);
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'manifest.json'))), manifest);
  }
});
