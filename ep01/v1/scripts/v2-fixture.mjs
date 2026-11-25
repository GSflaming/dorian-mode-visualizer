import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { wav } from './v2-audio.mjs';

export async function fixture(dir, fps = 30) {
  const model = JSON.parse(await readFile(new URL('../tests/fixtures/v2.json', import.meta.url)));
  model.fps = fps;
  const track = model.scenes[0];
  const offset = track.audio.sourceInMs;
  const pitches = { Em7: [52, 55, 59, 62], A7: [45, 55, 61, 64], Cmaj7: [48, 55, 59, 64] };
  const pcm = new Float32Array((offset + track.endMs + 50) * 96);
  for (const h of track.harmony) {
    const count = (h.endMs - h.startMs) * 48;
    for (let i = 0; i < count; i++) {
      const t = i / 48000;
      const env = Math.min(1, i / 160, (count - i) / 360) * (0.8 + 0.2 * Math.cos(t * 8));
      const sample = pitches[h.symbol].reduce(
        (sum, n) => sum + Math.sin(2 * Math.PI * 440 * 2 ** ((n - 69) / 12) * t) * 0.095,
        0,
      );
      const index = ((offset + h.startMs) * 48 + i) * 2;
      pcm[index] = pcm[index + 1] = env * sample;
    }
  }
  await mkdir(resolve(dir, 'tracks'), { recursive: true });
  await writeFile(resolve(dir, 'tracks', track.audio.file), wav(pcm));
  await writeFile(resolve(dir, 'v2.json'), JSON.stringify(model, null, 2) + '\n');
  return model;
}
