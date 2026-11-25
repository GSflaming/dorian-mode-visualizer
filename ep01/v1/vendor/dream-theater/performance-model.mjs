import { PRESETS } from './vendor/fret-note/music.mjs';

const fretValid = fret => Number.isInteger(fret) && fret >= 0 && fret <= 24;
const inRange = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;

function validateTechniques(techniques, fail) {
  if (techniques === undefined) return;
  if (!techniques || typeof techniques !== 'object' || Array.isArray(techniques)) fail('Invalid guitar techniques');
  const { bend, vibrato, slide, sustain, mute } = techniques;
  if (bend !== undefined && (!Array.isArray(bend) || bend.some((point, index) =>
    !point || !inRange(point.at, 0, 1) || !inRange(point.semitones, -12, 12) ||
    (index > 0 && point.at <= bend[index - 1].at)))) fail('Invalid bend curve');
  if (vibrato !== undefined && (!vibrato || !inRange(vibrato.depth, 0, 4) ||
    !inRange(vibrato.rate, 1, 20) || !inRange(vibrato.delay ?? 0, 0, Infinity))) fail('Invalid vibrato');
  if (slide !== undefined && (!slide || (slide.fromFret == null && slide.toFret == null) ||
    (slide.fromFret != null && !fretValid(slide.fromFret)) || (slide.toFret != null && !fretValid(slide.toFret)) ||
    !inRange(slide.seconds ?? .18, .001, Infinity))) fail('Invalid slide');
  if ([sustain, mute].some(flag => flag !== undefined && typeof flag !== 'boolean')) fail('Invalid sustain or mute flag');
}

// Times are seconds on the supplied recording, never inferred from chord symbols.
export function validatePerformance(input, { requireComplete = false, allowEstimated = false } = {}) {
  const fail = message => { throw new Error(message); };
  if (input.version !== 1) fail('Unsupported performance format');
  if (!(Number.isFinite(input.duration) && input.duration > 0)) fail('Invalid duration');
  if (!Array.isArray(input.sources)) fail('Missing score sources');
  const sourceIds = new Set(input.sources.map(source => source.id));
  for (const role of ['guitar', 'piano']) {
    const part = input[role];
    if (!part || !Array.isArray(part.notes)) fail(`Missing ${role} notes`);
    if (!['missing', 'draft', 'estimated', 'reviewed'].includes(part.status)) fail(`Invalid ${role} status`);
    if (part.status === 'missing' && part.notes.length) fail(`${role}: missing part cannot contain notes`);
    if (requireComplete && (!(part.status === 'reviewed' || (allowEstimated && part.status === 'estimated')) || !part.notes.length)) {
      fail(`${role}: 需要取得逐音谱并完成原录音校对，不能用和弦组成音代替演奏`);
    }
    const tuning = part.tuning ?? PRESETS.standard.notes;
    if (role === 'guitar' && (!Array.isArray(tuning) || tuning.length < 4 || tuning.length > 12 ||
      tuning.some(p => !Number.isInteger(p) || p < 0 || p > 127))) fail('Invalid tuning');
    for (const note of part.notes) {
      if (!Number.isFinite(note.start) || !Number.isFinite(note.end) || note.start < 0 || note.end <= note.start || note.end > input.duration + 0.02) fail(`${role}: invalid note time`);
      const muted = role === 'guitar' && note.techniques?.mute === true;
      if (!(muted && note.pitch == null) && (!Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127)) fail(`${role}: invalid MIDI pitch`);
      if (!sourceIds.has(note.sourceId)) fail(`${role}: missing note provenance`);
      if (role === 'guitar') {
        if (!Number.isInteger(note.string) || note.string < 1 || note.string > tuning.length || !fretValid(note.fret)) fail('Guitar notes require score-based string and fret');
        if (note.pitch != null && tuning[tuning.length - note.string] + note.fret !== note.pitch) fail('Guitar pitch does not match tuning/string/fret');
        validateTechniques(note.techniques, fail);
      }
    }
  }
  return input;
}

export function matchPerformance(song, input) {
  const parts = validatePerformance(input);
  const audio = song.audioMetadata;
  if (!parts.audioSha256 || parts.audioSha256 !== audio.sha256) throw new Error('逐音谱与项目录音的 SHA-256 不匹配');
  if (Math.abs(audio.durationSeconds - parts.duration) > .025) throw new Error('逐音谱与项目录音的时长不匹配');
  return parts;
}

export function notesAt(notes, time) {
  return notes.filter(note => note.start <= time && time < note.end);
}

// Piecewise score-to-recording alignment preserves tempo drift and local edits.
export function mapScoreTime(time, anchors) {
  if (!anchors?.length || anchors.some((a, i) => !Number.isFinite(a.score) || !Number.isFinite(a.audio) ||
    (i > 0 && (a.score <= anchors[i - 1].score || a.audio <= anchors[i - 1].audio)))) {
    throw new Error('Alignment anchors must increase in score and audio time');
  }
  if (anchors.length === 1) return time + anchors[0].audio - anchors[0].score;
  let i = anchors.findIndex(anchor => anchor.score > time);
  i = i < 0 ? anchors.length - 1 : Math.max(1, i);
  const a = anchors[i - 1], b = anchors[i];
  return a.audio + (time - a.score) * (b.audio - a.audio) / (b.score - a.score);
}

export function pianoFromSequence(sequence, instruments, sourceId, anchors) {
  if (!Array.isArray(instruments) || !instruments.length) throw new Error('Select the piano MIDI tracks explicitly');
  return sequence.notes.filter(note => !note.isDrum && instruments.includes(note.instrument ?? 0)).map(note => ({
    pitch: note.pitch,
    start: mapScoreTime(note.startTime, anchors),
    end: mapScoreTime(note.endTime, anchors),
    velocity: note.velocity ?? 80,
    instrument: note.instrument ?? 0,
    sourceId,
  })).sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}
