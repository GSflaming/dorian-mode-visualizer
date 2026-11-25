import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { studyDemo, synthStudy } from '../../../examples/study-demo.mjs';
import { prepare } from '../scripts/prepare-v2.mjs';
import { output, wav } from '../scripts/v2-audio.mjs';

const dir = resolve(output, 'part2-demo');
const tracks = resolve(dir, 'tracks');
const config = resolve(dir, 'v2.json');
const { model, events } = studyDemo();
await mkdir(tracks, { recursive: true });
for (const scene of model.scenes) {
  const notes = events.filter((event) => event.excerptId === scene.excerptId);
  await writeFile(resolve(tracks, scene.audio.file), wav(synthStudy(notes, scene.endMs - scene.startMs)));
}
await writeFile(config, JSON.stringify(model, null, 2) + '\n');
await prepare(config, tracks, dir, 'node', events);
console.log('Synthetic studies ready. Run npm run preview, or npm run render -- --study-demo.');
