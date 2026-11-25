import { normalizeSong } from './data.mjs';
import { parseChord, parseNote, pc, harmonicRelation, guitarPositions, positionVoices, theoreticalVoices } from './theory.mjs';
import { EPS, floorIndex } from './timing.mjs';
import { VoiceLeadingEngine } from './voice-leading.mjs';
import { fullName } from './vendor/fret-note/music.mjs';

export const tensionFeatures = {
  interval: '音程类加权',
  extension: '延伸及变化音',
  change: '相邻音级集合差异',
  motion: '平均声部位移',
};
export const defaultWeights = { interval: 3, extension: 2, change: 2, motion: 1 };
const pitchDelta = (a, b) => ((b - a + 18) % 12) - 6;
const contiguous = (a, b) => a && b && Math.abs(a.end - b.start) < EPS;
const activeIndex = (entries, time) => {
  const index = floorIndex(entries, time, 'start');
  return index >= 0 && time < entries[index].end - EPS ? index : -1;
};

export function coverageGaps(entries, duration, predicate = () => true) {
  const gaps = [];
  let end = 0;
  for (const event of entries.filter(predicate)) {
    if (event.start >= duration) break;
    if (event.end <= 0) continue;
    if (event.start > end + EPS) gaps.push({ start: end, end: event.start });
    end = Math.max(end, Math.min(duration, event.end));
  }
  if (end < duration - EPS) gaps.push({ start: end, end: duration });
  return gaps;
}

function bassRuns(events, theoretical, harmony) {
  let run;
  const entries = events.map((entry, index) => {
    const value = theoretical ? entry.pc : entry.midi;
    const previous = events[index - 1];
    const adjacent = contiguous(previous, entry);
    const delta = adjacent ? theoretical ? pitchDelta(previous.pc, value) : value - previous.midi : null;
    const height = adjacent && theoretical ? run.height + delta : value;
    if (adjacent && delta === 0) {
      run.end = entry.end;
      run.count++;
    } else run = { start: entry.start, end: entry.end, count: 1, pedal: false, height };
    return { ...entry, delta, height, run };
  });
  for (const current of new Set(entries.map(entry => entry.run))) {
    const symbols = new Set(harmony.filter(event => event.start < current.end - EPS &&
      event.end > current.start + EPS).map(event => event.chord.symbol));
    current.pedal = symbols.size > 1;
  }
  return entries;
}

function estimateTension(chord, previous, transition, weights) {
  const roughness = [0, 1, .6, .28, .22, .18, .92];
  const pitches = [...new Set(chord.tones.map(tone => tone.pc))];
  if (pitches.length < 3) return null;
  let interval = 0;
  let pairs = 0;
  for (const [i, a] of pitches.entries()) {
    for (const b of pitches.slice(i + 1)) {
      const difference = pc(a - b);
      interval += roughness[Math.min(difference, 12 - difference)];
      pairs++;
    }
  }
  const previousPitches = previous?.chord.tones.map(tone => tone.pc) ?? [];
  const union = new Set([...previousPitches, ...pitches]).size;
  const moves = transition?.metrics.moves.filter(move => move.semitones !== null).length;
  const features = {
    interval: interval / pairs,
    extension: chord.tones.filter(tone => tone.degree > 7 || /[b#]/.test(tone.interval) && tone.degree === 5).length / chord.tones.length,
    change: previous ? 1 - pitches.filter(pitch => previousPitches.includes(pitch)).length / union : null,
    motion: moves ? Math.min(1, transition.metrics.total / moves / 6) : null,
  };
  const weight = Object.entries(features).reduce((sum, [key, value]) => sum + (value == null ? 0 : weights[key]), 0);
  if (weight === 0) return null;
  const contributions = Object.fromEntries(Object.entries(features).filter(([, value]) => value !== null)
    .map(([key, value]) => [key, 100 * value * weights[key] / weight]));
  return { value: Object.values(contributions).reduce((sum, n) => sum + n, 0), features, contributions };
}

function sourceFor(event, layer) {
  if (layer === 'theory') return { voices: theoreticalVoices(event.chord), positions: [] };
  return event.layers[layer] ?? null;
}

export function compileSong(input, options = {}) {
  const { song, timing } = normalizeSong(input);
  const duration = song.audioMetadata.durationSeconds;
  const layer = options.layer ?? 'theory';
  const strategy = options.strategy ?? 'minimum';
  const weights = Object.fromEntries(Object.entries(defaultWeights).map(([key, value]) => [
    key, Number.isFinite(options.weights?.[key]) ? Math.max(0, options.weights[key]) : value,
  ]));
  const stamps = (entry) => ({ ...entry, start: timing.seconds(entry.startBeat), end: timing.seconds(entry.endBeat) });
  const sections = song.sections.map(stamps);
  const regions = song.keyRegions.map(stamps);
  const voicings = new Map(song.voicings.map(voicing => [JSON.stringify([voicing.chordId, voicing.layer]), voicing]));
  const events = song.chordEvents.map(entry => {
    const chord = parseChord(entry.symbol);
    const layers = {};
    for (const type of ['selected', 'recording']) {
      const voicing = voicings.get(JSON.stringify([entry.id, type]));
      if (!voicing || voicing.reviewRequired) continue;
      const positions = positionVoices(voicing.positions ?? [], chord);
      const voices = (voicing.voices ?? positions).map(voice => ({
        ...voice, name: voice.name ?? fullName(voice.midi, chord.root.name.includes('b')),
      }));
      layers[type] = { positions, voices, provenance: voicing };
    }
    return { ...stamps(entry), chord, positions: guitarPositions(chord), layers };
  });
  const gaps = coverageGaps(events, duration);
  const unverified = coverageGaps(events, duration, entry => entry.status === 'Verified');
  const theoretical = bassRuns(events.map(event => ({
    ...event, name: event.chord.bass.name, pc: event.chord.bass.pc, midi: null, status: 'Estimated',
  })), true, events);
  const bassTracks = [...new Set(song.bassEvents.map(event => event.track))];
  const track = options.bassTrack ?? 'symbol';
  const bass = track === 'symbol' ? theoretical : bassRuns(song.bassEvents.filter(event => event.track === track)
    .map(event => ({ ...stamps(event), name: event.name ?? fullName(event.midi, true) })), false, events);
  const rootRuns = [];
  let rootRun;
  for (const [i, event] of events.entries()) {
    const previous = events[i - 1];
    if (!contiguous(previous, event) || pitchDelta(previous.chord.root.pc, event.chord.root.pc) !== -1) {
      rootRun = [event];
    } else {
      rootRun.push(event);
      if (rootRun.length === 3) rootRuns.push(rootRun);
    }
  }
  for (const run of rootRuns) {
    const roots = run.map(event => event.chord.root.name);
    for (const [index, event] of run.entries()) {
      event.chromaticRoots = roots;
      event.chromaticIndex = index;
    }
  }
  const authoredTransitions = new Map(song.voiceLeadingEvents.map(entry =>
    [JSON.stringify([entry.fromId, entry.toId, entry.mode]), entry]));
  const transitions = events.map((event, index) => {
    const previous = events[index - 1];
    if (!contiguous(previous, event)) return null;
    const commonClasses = previous.chord.tones.filter(tone => event.chord.tones.some(next => next.pc === tone.pc));
    const rootStep = pitchDelta(previous.chord.root.pc, event.chord.root.pc);
    const left = sourceFor(previous, layer);
    const right = sourceFor(event, layer);
    const annotation = authoredTransitions.get(JSON.stringify([previous.id, event.id, strategy]));
    const matchable = left && right && (strategy !== 'guitar' || (left.positions.length && right.positions.length)) &&
      (strategy !== 'fixed' || (left.voices.some(voice => voice.id != null) && right.voices.some(voice => voice.id != null)));
    if (!matchable) return { commonClasses, rootStep, annotation, metrics: null };
    const voices = (source) => (strategy === 'guitar' ? source.positions : source.voices)
      .map(voice => ({ ...voice, name: voice.name ?? fullName(voice.midi, true) }))
      .sort((a, b) => b.midi - a.midi);
    const before = voices(left);
    const after = voices(right);
    return {
      commonClasses, rootStep, annotation, before, after,
      metrics: VoiceLeadingEngine.analyze(before, after, { mode: strategy }),
      seconds: Math.min(.55, (event.end - event.start) * .75),
    };
  });
  const tension = events.map((event, index) => estimateTension(event.chord,
    contiguous(events[index - 1], event) ? events[index - 1] : null,
    transitions[index]?.metrics ? transitions[index] : null, weights));
  return { song, timing, duration, sections, regions, events, gaps, unverified, bass, bassTracks, track,
    layer, strategy, transitions, rootRuns, tension, weights, compiled: true };
}

function functionalHint(event, key, next, degree) {
  const tonic = parseNote(key.tonic);
  const chord = event.chord;
  if (chord.bass.pc === tonic.pc && chord.root.pc !== tonic.pc) return `主音低音上的 ${degree} 上层结构`;
  if (chord.root.pc === tonic.pc) return '主音上的和弦';
  if (pc(chord.root.pc - tonic.pc) === 7 && chord.tones.some(tone => tone.interval === '3') &&
      chord.tones.some(tone => tone.interval === 'b7')) {
    return contiguous(event, next) && next.chord.root.pc === tonic.pc ? '属七至主音 · 功能候选' : '属七结构 · 解决待查';
  }
  return null;
}

export function getVisualState(songAnalysis, playbackTime) {
  const model = songAnalysis.compiled ? songAnalysis : compileSong(songAnalysis);
  const time = Math.max(0, Math.min(model.duration, Number.isFinite(playbackTime) ? playbackTime : 0));
  const lookup = Math.min(time, Math.max(0, model.duration - EPS * 2));
  const beat = model.timing.beat(time);
  const index = activeIndex(model.events, lookup);
  const chord = model.events[index] ?? null;
  const next = index >= 0 ? model.events[index + 1] : model.events[floorIndex(model.events, lookup, 'start') + 1];
  const previous = index >= 0 ? model.events[index - 1] : model.events[floorIndex(model.events, lookup, 'start')];
  const transition = model.transitions[index] ?? null;
  const keys = model.regions.filter(region => region.start <= lookup + EPS && lookup < region.end - EPS);
  const bass = model.bass[activeIndex(model.bass, lookup)] ?? null;
  const section = model.sections[activeIndex(model.sections, lookup)] ?? null;
  const progress = transition?.metrics ? Math.min(1, Math.max(0, (time - chord.start) / transition.seconds)) : 1;
  return {
    time, beat, position: model.song.audioMetadata.calibrated ? model.timing.position(beat) : null,
    chord, previous, next, section, keys, bass, transition, progress,
    rootRun: chord?.chromaticRoots ?? null,
    relations: chord ? keys.map(key => {
      const degree = harmonicRelation(chord.chord, key);
      return { key, degree, function: functionalHint(chord, key, next, degree) };
    }) : [],
    tension: model.tension[index] ?? null,
    layer: model.layer, positions: chord ? model.layer === 'theory' ? chord.positions : chord.layers[model.layer]?.positions ?? [] : [],
  };
}
