import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { groups, instruments, RATE } from '../score.mjs';
import { guitarGesture } from '../vendor/dream-theater/presentation.mjs';
import { openBank } from './dls.mjs';

const { values: args } = parseArgs({ options: {
  replacements: { type: 'string' },
  bank: { type: 'string' },
  'mix-dir': { type: 'string' },
} });
const bankPath = args.bank ?? process.env.DORIAN_DLS ??
  '/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls';
const bank = openBank(await readFile(bankPath));
const output = fileURLToPath(new URL('../output/', import.meta.url));
const score = JSON.parse(await readFile(resolve(output,'score.json'), 'utf8'));
const mixDirectory = resolve(args['mix-dir'] ?? output);
const replacements = args.replacements ? JSON.parse(await readFile(resolve(args.replacements), 'utf8')) : {};
for (const key of Object.keys(replacements)) if (!groups.includes(key)) throw new Error(`Unknown replacement group ${key}`);
const frames = Math.round(score.duration * RATE);
const bytes = frames * 2 * Float32Array.BYTES_PER_ELEMENT;
const tau = Math.PI * 2;
const beats = score.quarter;
const master = new Float32Array(frames * 2);
const outputStems = resolve(mixDirectory, 'stems');
await mkdir(outputStems, { recursive: true });

const perTrack = {
  guitar: { level: .265, attack: .003, release: .085, pan: -.18 },
  bass: { level: .21, attack: .004, release: .06, pan: 0 },
  pad: { level: .049, attack: .20, release: .26, pan: -.01 },
  poly: { level: .116, attack: .010, release: .155, pan: .35 },
  lead: { level: .18, attack: .022, release: .13, pan: .20 },
  drums: { level: .29, attack: .001, release: .08, pan: 0 },
};

const warm = signal => Math.tanh(signal * 1.32) / .865;
function renderNote(target, note, track) {
  const settings = perTrack[track];
  const drum = track === 'drums';
  const bass = track === 'bass';
  const guitar = track === 'guitar';
  const pad = track === 'pad';
  const poly = track === 'poly';
  const develop = guitar && note.start >= score.scenes.find(scene => scene.id === 'improv').start;
  const sample = guitar || bass || drum ? bank(guitar ? 27 : bass ? 33 : 0, note.pitch, drum) : null;
  const frequency = 440 * 2 ** ((note.pitch - 69) / 12);
  const offset = Math.round(note.start * RATE);
  const sustain = note.end - note.start;
  const dry = sample && drum ? Math.min(sample.data.length / sample.rate, note.pitch === 49 ? 1.3 : note.pitch === 46 ? .6 : .42) : sustain;
  const duration = Math.min(frames - offset, Math.ceil((dry + settings.release) * RATE));
  const pan = drum ? ({42:.33,46:.36,49:-.35}[note.pitch] ?? 0) : settings.pan;
  const leftGain = Math.sqrt((1 - pan) / 2);
  const rightGain = Math.sqrt((1 + pan) / 2);
  const level = settings.level * (note.velocity / 100) ** 1.6 *
    (drum ? ({36:1.08,38:.62,42:.30,46:.24,49:.26}[note.pitch] ?? .5) : 1);
  const sampleStep = sample ? sample.rate / RATE * 2 ** ((note.pitch - sample.root) / 12) : 0;
  let position = 0;
  let playbackStep = sampleStep;
  let lowpass = 0;
  for (let index = 0; index < duration; index++) {
    const t = index / RATE;
    const envelope = Math.min(1,t / settings.attack) *
      (t > dry ? Math.max(0, 1 - (t - dry) / settings.release) ** 2 : 1);
    let left;
    let right;
    if (sample) {
      if (guitar && note.techniques && (index & 31) === 0) {
        const time = Math.min(note.end, note.start + t);
        const gesture = guitarGesture(note,time);
        const change = gesture.fret - note.fret + gesture.bend + gesture.oscillation;
        playbackStep = sampleStep * 2 ** (change / 12);
      }
      if (sample.loopEnd && position >= sample.loopEnd) {
        position = sample.loopStart + ((position - sample.loopEnd) % (sample.loopEnd - sample.loopStart));
      }
      const i = position | 0;
      if (i >= sample.data.length - 1) break;
      const next = sample.loopEnd && i + 1 === sample.loopEnd ? sample.loopStart : i + 1;
      const raw = (sample.data[i] + (sample.data[next] - sample.data[i]) * (position - i)) / sample.peak;
      position += playbackStep;
      lowpass += (raw - lowpass) * (bass ? .12 : guitar ? .42 : .70);
      const sustainShape = guitar ? .37 + .63 * Math.exp(-t * 1.75) : bass ? .52 + .48 * Math.exp(-t * 2.8) : 1;
      const filtered = guitar ? warm(lowpass * (develop ? 1.22 : 1)) : bass ? .83 * lowpass + .17 * raw : raw;
      left = right = filtered * sustainShape;
    } else {
      const cycle = tau * frequency * t;
      if (pad) {
        const voice = phase => .72 * Math.sin(phase) + .24 * Math.sin(phase * 2) + .1 * Math.sin(phase * 3);
        const modulation = .18 * Math.sin(tau * .58 * t + note.pitch);
        left = .56 * voice(cycle * .9981) + .44 * voice(cycle + modulation);
        right = .56 * voice(cycle * 1.0019) + .44 * voice(cycle - modulation);
      } else if (poly) {
        left = right = Math.sin(cycle + .88 * Math.exp(-7*t) * Math.sin(cycle * 2.004)) * (.12 + .88 * Math.exp(-3.4*t));
      } else {
        const phase = cycle + .48 * Math.sin(tau * 5.1 * t) * Math.min(1, t * 3);
        left = .85 * Math.sin(phase) + .15 * Math.sin(3 * phase);
        right = .83 * Math.sin(phase + .12) + .17 * Math.sin(3 * phase + .35);
      }
    }
    const signal = level * envelope;
    target[2*(offset + index)] += left * signal * leftGain;
    target[2*(offset + index)+1] += right * signal * rightGain;
  }
}

function ambience(target, taps) {
  // The dry signal retains its score-time attack. Feedback and reverb are confined to this stem.
  for (const [seconds, left, right] of taps) {
    const offset = Math.round(seconds * RATE) * 2;
    for (let index = target.length - 2; index >= offset; index -= 2) {
      target[index] += target[index-offset+1] * left;
      target[index+1] += target[index-offset] * right;
    }
  }
}

function ffmpeg(args, opts = {}) {
  const result = spawnSync('ffmpeg', ['-nostdin','-hide_banner','-v','error',...args], opts);
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? String(result.stderr));
  return result.stdout;
}

function importReplacement(group, replacement) {
  const file = resolve(replacement.file);
  const offset = replacement.offsetSeconds ?? 0;
  const trim = replacement.trimSeconds ?? 0;
  const gain = replacement.gainDb ?? 0;
  if (!/\.(?:wav|flac)$/i.test(file) || ![offset,trim,gain].every(Number.isFinite) || trim < 0 || Math.abs(offset) >= score.duration) {
    throw new Error(`Invalid ${group} stem alignment`);
  }
  const details = JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','a:0',
    '-show_entries','stream=duration,channels,codec_name','-of','json',file],{encoding:'utf8'})).streams[0];
  const length = Number(details?.duration);
  if (!details || !/^(?:pcm_|flac)/.test(details.codec_name) || ![1,2].includes(details.channels) ||
      !Number.isFinite(length) || length - trim + offset < score.duration - .025) {
    throw new Error(`${group}: use a complete, aligned mono or stereo lossless stem`);
  }
  const start = Math.round((trim + Math.max(0,-offset)) * RATE);
  const delay = Math.round(Math.max(0,offset) * RATE);
  const filter = `aresample=${RATE},atrim=start_sample=${start},asetpts=N/SR/TB,adelay=${delay}S:all=1,volume=${gain}dB,apad=whole_len=${frames},atrim=end_sample=${frames}`;
  const data = ffmpeg(['-i',file,'-map','0:a:0','-af',filter,'-ar',String(RATE),'-ac','2','-f','f32le','-'], {maxBuffer: bytes + 8192});
  return new Float32Array(data.buffer,data.byteOffset,frames*2);
}

async function encode(target, path, format) {
  const temp = path + `.new-${process.pid}.${format}`;
  const pcm = Buffer.from(target.buffer,target.byteOffset,target.byteLength);
  try {
    ffmpeg(['-y','-f','f32le','-ar',String(RATE),'-ac','2','-i','pipe:0','-c:a',format === 'wav' ? 'pcm_s24le' : 'flac',
      ...(format === 'flac' ? ['-sample_fmt','s32','-bits_per_raw_sample','24','-compression_level','8'] : []),temp],{ input:pcm });
    await rename(temp,path);
  } finally {
    await rm(temp,{force:true});
  }
}

for (const group of groups) {
  const audio = replacements[group] ? importReplacement(group,replacements[group]) : new Float32Array(frames*2);
  if (!replacements[group]) {
    for (const [track,instrument] of Object.entries(instruments)) {
      if (instrument.group === group) for (const note of score.notes[track]) renderNote(audio,note,track);
    }
    if (group === 'guitar') ambience(audio,[[beats*.75,.15,.22],[.041,.06,.04],[beats*1.5,.055,.04]]);
    if (group === 'keys') ambience(audio,[[.063,.12,.10],[.113,.065,.055],[beats*.75,.075,.075]]);
    if (group !== 'bass') {
      const fadeLength = Math.round(.17 * RATE);
      for (let i=0;i<fadeLength;i++) {
        const at=frames-fadeLength+i;
        const gain=1-i/fadeLength;
        audio[2*at]*=gain;
        audio[2*at+1]*=gain;
      }
    }
  }
  for (let i = 0; i < audio.length; i++) master[i] += audio[i];
  const filename = group === 'keys' ? 'synth' : group;
  if (audio.some(value=>!Number.isFinite(value)||Math.abs(value)>=1)) {
    throw new Error(`${group} stem exceeds PCM range. Reduce gainDb before mixing.`);
  }
  await encode(audio,resolve(outputStems,filename+'.flac'),'flac');
  console.log(`${filename}.flac${replacements[group] ? ' (replacement)' : ''}`);
}

let peak = 0;
for (const value of master) peak = Math.max(peak,Math.abs(value));
if (!Number.isFinite(peak) || peak < .04) throw new Error('Master is empty or invalid');
const masterGain = .85 / peak;
for (let i = 0; i < master.length; i++) master[i] *= masterGain;
await encode(master,resolve(mixDirectory,'Dorian-V1-mix.wav'),'wav');
await writeFile(resolve(mixDirectory,'mix-settings.json'), JSON.stringify({
  sampleRate: RATE, channels: 2, frames, masterLinearGain: masterGain, scoreSeconds: score.duration,
  replacements: Object.keys(replacements), generatedFrom: 'score.json',
  eventHash: createHash('sha256').update(JSON.stringify([score.duration,score.notes])).digest('hex'),
},null,2)+'\n');
console.log(`Master PCM 24-bit · peak ${(20*Math.log10(.85)).toFixed(1)} dBFS`);
