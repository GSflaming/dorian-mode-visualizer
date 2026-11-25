import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyze } from '../v2/dsp.mjs';
import { decode, output, sha, tracks, wav } from '../scripts/v2-audio.mjs';
import { prepare } from '../scripts/prepare-v2.mjs';
import { render } from '../scripts/render-v2.mjs';
import { lessons, songs } from './lesson.mjs';

const evidenceFile = new URL('evidence.json', import.meta.url);
if (!existsSync(evidenceFile)) {
  throw Error('Provide your local, authorized performance events in part2/evidence.json. See docs/workflows.md.');
}
const { events: studyEvents } = JSON.parse(readFileSync(evidenceFile, 'utf8'));
if (!Array.isArray(studyEvents)) throw Error('part2/evidence.json must contain an events array.');

const dir = resolve(output, 'part2');
const assets = resolve(dir, 'tracks');
mkdirSync(assets, { recursive: true });

const requiredFiles = [...new Set(lessons.map((l) => l.file))];
const missing = requiredFiles.filter((f) => !existsSync(resolve(tracks, f)));
if (missing.length) {
  throw Error(`缺少原曲录音素材 (${missing.join('、')})，请放入 ep01/assets/audio/tracks/`);
}
for (const f of requiredFiles) {
  copyFileSync(resolve(tracks, f), resolve(assets, f));
}

const scenes = [];
let clock = 0;
for (const l of lessons) {
  const harmony = (l.harmony ?? []).map((h) => ({
    startMs: clock + h.at,
    endMs: clock + h.end,
    symbol: h.symbol,
    mode: h.mode,
    ...(h.label ? { label: h.label } : {}),
  }));
  const cues = (l.cues ?? []).map((c) => ({
    startMs: clock + c.at,
    endMs: clock + c.end,
    line1: c.line1,
  }));
  scenes.push({
    id: l.id,
    title: l.title,
    view: 'case_study',
    study: l.id,
    excerptId: l.excerptId,
    tonic: songs[l.song].tonicName,
    startMs: clock,
    endMs: clock + l.durationMs,
    audioMode: 'external_audio',
    audio: {
      file: l.file,
      sourceInMs: l.sourceInMs,
      title: songs[l.song].name,
      artist: 'Pink Floyd',
      edition: l.edition,
    },
    harmony,
    cues,
  });
  clock += l.durationMs;
}

const cfg = resolve(dir, 'v2.json');
writeFileSync(
  cfg,
  JSON.stringify(
    { schemaVersion: 2, title: 'Pink Floyd · The Dark Side of the Moon Dorian 分析', fps: 60, durationMs: clock, scenes },
    null,
    2,
  ),
);
const manifest = await prepare(cfg, assets, dir);

// Same-song edits hand the next downbeat to one performance. Across songs,
// let the outgoing stereo sustain carry over, clearing its bass and centre first.
const joins = scenes.slice(1).map((next, i) => {
  const bar = lessons[i + 1].barStartsMs;
  const beat = (bar[1] - bar[0]) / 4;
  const crossSong = next.audio.file !== scenes[i].audio.file;
  return crossSong
    ? { before: Math.round(beat * 1.5), after: 440, crossSong }
    : { before: Math.round(beat / 4), after: 0, crossSong };
});
const totalFrames = clock * 48;
const mix = new Float32Array(totalFrames * 2);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (x) => x * x * (3 - 2 * x);
const lowPass = 1 - Math.exp(-2 * Math.PI * 180 / 48000);

for (const [idx, s] of scenes.entries()) {
  const gain = Math.min(...manifest.sources.filter((src) => src.file === s.audio.file).map((src) => src.gain));
  manifest.sources[idx].gain = gain;
  const entry = joins[idx - 1], exit = joins[idx];
  const preMs = entry?.before ?? 0, postMs = exit?.after ?? 0;
  const dur = s.endMs - s.startMs;
  const sourceStart = s.audio.sourceInMs - preMs;
  const { samples } = decode(resolve(assets, s.audio.file), sourceStart, dur + preMs + postMs);
  const base = (s.startMs - preMs) * 48;
  const count = (dur + preMs + postMs) * 48;
  const exitStart = (preMs + dur - (exit?.before ?? 0)) * 48;
  let lowL = 0, lowR = 0;
  for (let i = 0; i < count; i++) {
    let l = samples[2 * i], r = samples[2 * i + 1];
    let env = 1;
    if (entry && i < preMs * 48) {
      env = Math.sin(Math.PI / 2 * smooth(i / (preMs * 48)));
    } else if (!entry && i < 1200 * 48) {
      env = Math.sin(Math.PI / 2 * i / (1200 * 48));
    }
    if (exit && i >= exitStart) {
      const phase = clamp01((i - exitStart) / (count - exitStart));
      env *= Math.cos(Math.PI / 2 * smooth(phase));
      if (exit.crossSong) {
        lowL += lowPass * (l - lowL);
        lowR += lowPass * (r - lowR);
        const release = smooth(clamp01((i - exitStart) / (exit.before * 48)));
        l -= release * lowL;
        r -= release * lowR;
        const mid = (l + r) / 2;
        l -= release * 0.8 * mid;
        r -= release * 0.8 * mid;
      }
    } else if (!exit && count - i < 2400 * 48) {
      env *= Math.sin(Math.PI / 2 * (count - i) / (2400 * 48));
    }
    const o = 2 * (base + i);
    mix[o] += gain * env * l;
    mix[o + 1] += gain * env * r;
  }
}
manifest.joins = joins.map((j, i) => ({ ...j, atMs: scenes[i + 1].startMs }));

const bytes = wav(mix);
const masterPath = resolve(dir, 'master.wav');
writeFileSync(masterPath, bytes);

const left = new Float32Array(totalFrames), right = new Float32Array(totalFrames);
for (let i = 0; i < totalFrames; i++) {
  left[i] = mix[i * 2];
  right[i] = mix[i * 2 + 1];
}
const featuresJson = JSON.stringify({ ...analyze(left, right, 48000, 60), studyEvents });
writeFileSync(resolve(dir, 'features.json'), featuresJson);
manifest.masterHash = sha(bytes);
manifest.featuresHash = sha(featuresJson);
writeFileSync(resolve(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

if (!process.argv.includes('--prepare-only')) {
  await render({}, dir, cfg, assets);
  const exportDir = resolve(output, '../../../exports');
  mkdirSync(exportDir, { recursive: true });
  const final = resolve(exportDir, 'EP01-part2.mp4');
  const temp = final + '.' + process.pid + '.mp4';
  copyFileSync(resolve(dir, 'Dorian-V2.mp4'), temp);
  renameSync(temp, final);
  console.log(final);
}
