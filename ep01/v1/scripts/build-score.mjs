import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { buildScore, instruments } from '../score.mjs';

const out = new URL('../output/', import.meta.url);
const config = JSON.parse(await readFile(new URL('../config/film.json', import.meta.url)));
const score = buildScore(config);
await mkdir(out, { recursive: true });
await writeFile(new URL('score.json', out), JSON.stringify(score, null, 2) + '\n');

const ppq = 960;
const tickAt = seconds => Math.round((seconds / score.quarter) * ppq);
const variable = value => {
  const bytes = [value & 127];
  while ((value >>>= 7)) bytes.unshift((value & 127) | 128);
  return bytes;
};
const meta = (kind, bytes) => [255, kind, ...variable(bytes.length), ...bytes];
const name = value => meta(3, Buffer.from(value));
const chunk = (id, bytes) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([Buffer.from(id), length, Buffer.from(bytes)]);
};
function track(events) {
  let position = 0;
  const bytes = [];
  events.sort((a,b) => a.at - b.at || a.order - b.order).forEach(({ at, data }) => {
    bytes.push(...variable(at - position), ...data);
    position = at;
  });
  bytes.push(...variable(tickAt(score.duration) - position), 255, 47, 0);
  return chunk('MTrk', bytes);
}
const tempo = Math.round(60_000_000 / score.bpm);
const conductor = track([
  {at:0, order:0, data:name('Dorian V1 - original lesson')},
  {at:0, order:1, data:meta(0x51,[tempo >> 16, (tempo >> 8) & 255, tempo & 255])},
  {at:0, order:2, data:meta(0x58,[4,2,24,8])},
  ...score.scenes.map((s,i) => ({at:tickAt(s.start),order:3+i,data:meta(6,Buffer.from(s.id))}))
]);
const tracks = Object.entries(instruments).map(([id, instrument]) => {
  const { channel, program } = instrument;
  const events = [{at:0,order:0,data:name(id)}];
  if (program !== undefined) events.push({at:0,order:1,data:[192 | channel,program]});
  for (const note of score.notes[id]) {
    events.push({at:tickAt(note.start),order:3,data:[144 | channel,note.pitch,note.velocity]},
      {at:tickAt(note.end),order:2,data:[128 | channel,note.pitch,0]});
  }
  return track(events);
});
const header = chunk('MThd',[0,1,0,tracks.length+1,ppq >> 8,ppq & 255]);
await writeFile(new URL('Dorian-V1.mid', out), Buffer.concat([header, conductor, ...tracks]));
console.log(`${score.scenes.length} scenes · ${score.bars.length} bars · ${score.duration}s · ${score.frames} frames · ${Object.values(score.notes).reduce((sum, list)=>sum+list.length,0)} notes`);
