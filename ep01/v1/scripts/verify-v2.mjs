import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fixture } from './v2-fixture.mjs';
import { prepare } from './prepare-v2.mjs';
import { render } from './render-v2.mjs';
import { output, root } from './v2-audio.mjs';
execFileSync(process.execPath, [
  '--test',
  'tests/score.test.mjs',
  'tests/v2.test.mjs',
  '../tests/timeline.test.mjs',
], { cwd: root, stdio: 'inherit' });
const dir = resolve(output, 'demo'), cfg = resolve(dir, 'v2.json'), tracks = resolve(dir, 'tracks');
const model = await fixture(dir);
await prepare(cfg, tracks, dir);
for (const args of [{}, { scene: 'sixths' }, { 'snapshot-ms': '1087' }]) {
  await render(args, dir, cfg, tracks);
}
const movie = resolve(dir, 'Dorian-V2.mp4');
const [video, audio] =
  JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', movie])).streams;
assert.equal(video.codec_name, 'h264');
assert.equal(audio.codec_name, 'aac');
assert.equal(audio.channels, 2);
assert.equal(+video.nb_frames, Math.ceil(model.durationMs * model.fps / 1000));
assert.ok(Math.abs(+audio.duration - model.durationMs / 1000) <= 1 / 48000);
assert.ok(Math.abs(+video.duration - audio.duration) <= 1 / model.fps);
execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', movie, '-f', 'null', '-']);
const f = JSON.parse(await readFile(resolve(dir, 'features.json')));
assert.ok(f.frames[30].chroma[1] > 0.8 && f.frames[54].chroma[0] > 0.8);
console.log('验收通过 · ' + movie);
