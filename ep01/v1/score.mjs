import phrases from './config/phrases.mjs';
import { parseChord, pc } from './vendor/dream-theater/theory.mjs';
import { validatePerformance } from './vendor/dream-theater/performance-model.mjs';
import { PRESETS } from './vendor/dream-theater/vendor/fret-note/music.mjs';

export const RATE = 48000;
export const instruments = {
  guitar: { label: '电吉他', group: 'guitar', channel: 0, program: 27 },
  pad: { label: '和弦铺底', group: 'keys', channel: 1, program: 89 },
  poly: { label: '合成器琶音', group: 'keys', channel: 2, program: 4 },
  lead: { label: '合成器主奏', group: 'keys', channel: 3, program: 81 },
  bass: { label: '电贝斯', group: 'bass', channel: 4, program: 33 },
  drums: { label: '鼓', group: 'drums', channel: 9 },
};
export const groups = ['guitar', 'keys', 'bass', 'drums'];
export const modes = {
  dorian: { name: 'E Dorian', chinese: 'E 多利亚', pitches: [4,6,7,9,11,1,2], labels: ['E','F♯','G','A','B','C♯','D'] },
  aeolian: { name: 'E Aeolian', chinese: 'E 自然小调', pitches: [4,6,7,9,11,0,2], labels: ['E','F♯','G','A','B','C♮','D'] },
};
export const tuning = PRESETS.standard.notes;
export const sourceId = 'original-ep01';
const voicings = {
  'E5': [52,59,64], Em7: [55,59,62,64], A7: [55,57,61,64],
  'Em(add9)': [55,59,64,66], Em9: [55,59,62,64,66],
  Cmaj7: [55,59,60,64], Bm7: [54,57,62,71],
};
const bassRoots = { E5: 40, Em7: 40, A7: 45, 'Em(add9)': 40, Em9: 40, Cmaj7: 36, Bm7: 35 };
const keyAnswers = [
  [[0,.7,69,85],[.75,.42,71,82],[1.25,1.02,73,94],[2.5,.38,71,81],[3,.8,69,87]],
  [[0,.79,73,94],[1,.36,76,85],[1.5,.45,74,87],[2,1.35,73,92],[3.5,.35,69,81]],
];
export const chordFor = symbol => parseChord(symbol);
const assert = (test, description) => { if (!test) throw new Error(description); };
const quantize = seconds => Math.round(seconds * RATE) / RATE;

function guitarPosition(midi, center, sounding, technique) {
  const candidates = tuning.toReversed().map((open, index) => ({ string: index + 1, fret: midi - open }))
    .filter(item => item.fret >= 0 && item.fret <= 20 && !sounding.has(item.string) &&
      (!technique?.bend || item.fret >= 2));
  candidates.sort((a, b) => Math.abs(a.fret - center) - Math.abs(b.fret - center) || a.string - b.string);
  return candidates[0];
}

function scoreBar(scene, chord, index, write) {
  const { id } = scene;
  const intro = id === 'opening' && index < 2;
  const final = id === 'outro' && index === scene.chords.length - 1;
  const contrast = id === 'compare';
  const scale = id === 'scale' && index < 6;
  const chordDemo = id === 'harmony';
  const caseQuiet = id === 'breathe' && index < 2;
  const response = id === 'improv' && [9, 11].includes(index);
  const pitches = voicings[chord];
  const root = bassRoots[chord];
  const center = id === 'improv' && (index >= 6 && index <= 17) ? 12 :
    id === 'scale' ? 3 : id === 'harmony' ? 4 : id === 'compare' ? 7 : 8;
  const phrase = phrases[scene.phrases[index]];
  const guitar = [];
  for (const [beat, length, pitch, velocity, techniques, position] of phrase) {
    const used = new Set(guitar.filter(note => note.end > beat).map(note => note.string));
    const point = position ? { string: position[0], fret: position[1] } : guitarPosition(pitch, center, used, techniques);
    assert(point && !used.has(point.string), `${id} bar ${index + 1} has unplayable guitar fingering`);
    guitar.push({ end: beat + length, string: point.string });
    write('guitar', beat, length, pitch, velocity, { ...point, techniques: techniques ?? undefined });
  }
  if (scale && (index === 2 || index === 3)) {
    for (const [beat, length, pitch, velocity] of phrases[index === 2 ? 'scaleUp1' : 'scaleUp2']) {
      write('lead', beat, length, pitch + 12, velocity - 4);
    }
  }
  const padGain = (intro ? 54 : contrast ? 49 : scale ? 49 : chordDemo ? 62 : caseQuiet ? 58 : 53);
  pitches.forEach((pitch, i) => write('pad', 0, final ? 2.95 : 3.91, pitch,
    padGain + (i === 0 ? 1 : 0)));
  if (!intro && !contrast && !scale && !response && !final) {
    const pattern = chordDemo ? [0,1,2,3] : [0,.75,1.5,2.25,3,3.5];
    const order = chordDemo ? [0,1,2,3] : (index % 4 < 2 ? [0,2,1,3,2,1] : [1,3,2,0,2,3]);
    pattern.forEach((beat, i) => write('poly', beat, chordDemo ? .6 : .27, pitches[order[i] % pitches.length] + 12,
      (chordDemo ? 76 : 68) + [3,0,4,-5,2,0][i]));
  }
  if (response || id === 'opening' && index === 7 || id === 'outro' && index === 5) {
    for (const [beat,length,pitch,vel] of keyAnswers[index === 11 ? 1 : 0]) write('lead', beat, length, pitch + 12, vel);
  }
  if (final) {
    write('bass', 0, 3, root - 12, 93);
    write('drums', 0, .65, 36, 86);
    return;
  }
  if (contrast || scale) {
    write('bass', 0, 1.79, 40, 87);
    write('bass', 2, 1.6, 40, 79);
  } else if (intro || chordDemo || caseQuiet) {
    write('bass', 0, 1.75, root, 91);
    write('bass', 2, 1.45, root, 84);
  } else {
    const bassFifth = chord === 'Bm7' ? 42 : root + 7;
    write('bass', 0, 1.08, root, 95);
    write('bass', 1.5, .42, bassFifth, 77);
    write('bass', 2, .82, root, 89);
    write('bass', 3, .37, root, 81);
    write('bass', 3.5, .34, index % 4 === 3 ? root + 12 : bassFifth, 76);
  }
  if (intro) {
    write('drums', 0, .35, 36, 68);
    write('drums', 2, .20, 42, 55);
    return;
  }
  for (const [i, beat] of [0,.5,1,1.5,2,2.5,3,3.5].entries()) {
    if ((scale || chordDemo || caseQuiet) && i % 2) continue;
    write('drums', beat, .16, i === 7 && index % 4 === 3 && !contrast ? 46 : 42,
      [62,44,54,43,64,43,55,42][i] - (contrast || scale ? 7 : 0));
  }
  [0,2].forEach((beat,i) => write('drums', beat, .32, 36, (scale || contrast ? 73 : 91) - 9 * i));
  [1,3].forEach((beat,i) => write('drums', beat, .23, 38, (scale || contrast || chordDemo ? 65 : 79) + 3 * i));
  if (!contrast && !scale && !chordDemo && !caseQuiet) {
    if (index % 4 === 1 || index % 4 === 3) write('drums', 2.75, .25, 36, 70);
    if (index % 4 === 3) write('drums', 3.75, .19, 38, 50);
    if (index % 8 === 0) write('drums', 0, .95, 49, 48);
  }
}

export function buildScore(config) {
  const { bpm, beatsPerBar, fps } = config;
  assert(Number.isFinite(bpm) && bpm > 0 && beatsPerBar === 4 && Number.isInteger(fps) && fps > 0, 'Score requires positive BPM and 4/4');
  const quarter = 60 / bpm;
  const barSeconds = quarter * beatsPerBar;
  assert(Math.abs(barSeconds * fps - Math.round(barSeconds * fps)) < 1e-8, 'Bars must land on output frames');
  assert(config.scenes.length && new Set(config.scenes.map(scene => scene.id)).size === config.scenes.length, 'Scene IDs must be unique');
  const notes = Object.fromEntries(Object.keys(instruments).map(id => [id, []]));
  const bars = [];
  const scenes = config.scenes.map(scene => {
    const startBar = bars.length;
    assert(scene.chords.length > 0 && scene.chords.length === scene.phrases.length && modes[scene.mode],
      `${scene.id}: missing bar/chord/phrase/mode`);
    const start = quantize(startBar * barSeconds);
    const end = quantize((startBar + scene.chords.length) * barSeconds);
    let mode = scene.mode;
    for (const [local, symbol] of scene.chords.entries()) {
      mode = scene.modes?.find(([index]) => index === local)?.[1] ?? mode;
      assert(voicings[symbol] && phrases[scene.phrases[local]] && modes[mode], `${scene.id} bar ${local + 1} has unknown harmony or phrase`);
      const chord = chordFor(symbol);
      assert(voicings[symbol].every(pitch => chord.tones.some(tone => tone.pc === pc(pitch))), `${symbol} voicing disagrees with chord`);
      const at = start + local * barSeconds;
      scoreBar(scene, symbol, local, (track, beat, length, pitch, velocity, extra = {}) => {
        assert(beat >= 0 && length > 0 && beat + length <= beatsPerBar && pitch >= 0 && pitch <= 127 &&
          Number.isInteger(pitch) && velocity >= 1 && velocity <= 127, `${scene.id} invalid ${track} event in bar ${local + 1}`);
        notes[track].push({ start: quantize(at + quarter * beat), end: quantize(at + quarter * (beat + length)),
          pitch, velocity, track, sourceId, ...extra });
      });
      bars.push({ index: bars.length, local, start: quantize(at), end: quantize(at + barSeconds), mode,
        sceneId: scene.id, chord: symbol, voicing: voicings[symbol] });
    }
    const cues = scene.cues.map(([bar, beat, text, detail = '']) => {
      assert(Number.isInteger(bar) && bar >= 0 && bar < scene.chords.length && beat >= 0 && beat < beatsPerBar, `${scene.id} cue is outside its scene`);
      return { at: quantize(start + (bar * beatsPerBar + beat) * quarter), text, detail };
    }).sort((a,b) => a.at - b.at);
    return { ...scene, start, end, startBar, cues };
  });
  for (const track of Object.values(notes)) track.sort((a,b) => a.start - b.start || a.pitch - b.pitch);
  const duration = scenes.at(-1).end;
  const sources = [{ id: sourceId, title: 'EP01 原创教学演示' }];
  validatePerformance({ version: 1, duration, sources, guitar: { status: 'reviewed', tuning, notes: notes.guitar },
    piano: { status: 'reviewed', notes: [...notes.pad,...notes.poly,...notes.lead] } });
  return { title: config.title, subtitle: config.subtitle, bpm, fps, quarter, beatsPerBar, barSeconds,
    duration, frames: Math.round(duration * fps), scenes, bars, notes };
}
