import { guitarPositions, parseChord, parseNote, pc, tuning } from './vendor/tokyo/theory.mjs';
import { midiAt, noteName } from './vendor/tokyo/vendor/fret-note/music.mjs';

export const WIDTH = 1920;
export const HEIGHT = 1080;
export const RATE = 48000;
export const BOARD_RANGE = [0, 7];
export const modes = {
  aeolian: { name: 'E Aeolian', degrees: ['1', '2', '♭3', '4', '5', '♭6', '♭7'], notes: ['E', 'F♯', 'G', 'A', 'B', 'C♮', 'D'] },
  dorian: { name: 'E Dorian', degrees: ['1', '2', '♭3', '4', '5', '6', '♭7'], notes: ['E', 'F♯', 'G', 'A', 'B', 'C♯', 'D'] },
};
const pitch = (value) => parseNote(value.replaceAll('♮', ''));
for (const mode of Object.values(modes)) {
  mode.byPitch = new Map(mode.notes.map((name, index) => [pitch(name).pc, { name, interval: mode.degrees[index] }]));
}
const check = (condition, message) => { if (!condition) throw new Error(message); };
export const clamp = (value, max = 1) => Math.max(0, Math.min(max, value));
const finite = Number.isFinite;
const key = ({ string, fret }) => `${string}:${fret}`;

export function compile(project, recordings = {}, selectedIds) {
  check(project.fps === 60 && Array.isArray(project.scenes) && project.scenes.length, '场景配置需要 60 fps 和至少一个场景');
  const ids = project.scenes.map(scene => scene.id);
  check(new Set(ids).size === ids.length, '场景 ID 重复');
  for (const id of Object.keys(recordings)) check(ids.includes(id) && Array.isArray(recordings[id]), `无效实录场景 ${id}`);
  if (selectedIds) check(selectedIds.every(id => ids.includes(id)) && new Set(selectedIds).size === selectedIds.length, '场景 ID 不存在或重复');
  let frame = 0;
  const scenes = project.scenes.filter(scene => !selectedIds || selectedIds.includes(scene.id)).map(scene => {
    const { id, bpm, beatsPerBar, bars, cues, animations, audio } = scene;
    const beatSeconds = 60 / bpm;
    const barSeconds = beatSeconds * beatsPerBar;
    const frames = Math.round(bars.length * barSeconds * project.fps);
    const duration = frames / project.fps;
    check(finite(bpm) && bpm > 0 && Number.isInteger(beatsPerBar) && beatsPerBar > 0 &&
      frames > 0 && Math.abs(duration - bars.length * barSeconds) < 1e-8, `${id} 小节长度必须对齐 60 fps`);
    check(['compare', 'explain'].includes(scene.kind) && ['cut', 'fade'].includes(scene.transition?.type) &&
      (scene.transition.type === 'cut' || scene.transition.duration > 0 && scene.transition.duration <= duration), `${id} 画面或转场无效`);
    const trackIds = new Set();
    const tracks = audio.map(track => {
      check(typeof track.id === 'string' && track.id && !trackIds.has(track.id) &&
        /^[\w-]+\.wav$/i.test(track.file) && finite(track.at) && track.at < duration &&
        finite(track.sourceIn) && track.sourceIn >= 0 && finite(track.gainDb) &&
        (track.noteOffset === undefined || finite(track.noteOffset)) &&
        (track.until === undefined || finite(track.until) && track.until > Math.max(0, track.at) && track.until <= duration),
      `${id} 音轨配置无效`);
      trackIds.add(track.id);
      const calibrated = { ...track, at: Math.round(track.at * RATE) / RATE, sourceIn: Math.round(track.sourceIn * RATE) / RATE };
      return { ...calibrated, key: `${id}/${track.id}`, gain: Math.pow(10, track.gainDb / 20) };
    });
    const notes = (recordings[id] ?? []).map(note => {
      const track = tracks.find(item => item.id === note.track);
      const mid = pitch(note.pitch).midi;
      const hasPosition = note.string !== undefined || note.fret !== undefined;
      check(track && mid !== null && finite(note.time) && note.time >= 0 && finite(note.duration) && note.duration > 0,
        `${id} 实录事件需要有效音轨、音高八度、音头与时值`);
      if (hasPosition) check(Number.isInteger(note.string) && note.string >= 1 && note.string <= 6 &&
        Number.isInteger(note.fret) && note.fret >= 0 && note.fret <= 24 && midiAt(tuning, note.string, note.fret) === mid,
      `${id} ${note.pitch} 和弦号/品位不符`);
      const at = track.at + note.time - track.sourceIn + (track.noteOffset ?? 0);
      return { ...note, midi: mid, at, end: at + note.duration, track, hasPosition };
    });
    check(cues[0]?.at === 0 && cues.every((cue, index) => cue.at >= 0 && cue.at < duration &&
      (!index || cue.at > cues[index - 1].at) && cue.lines.every(([delay, line]) => finite(delay) &&
        delay >= 0 && delay + cue.at < (cues[index + 1]?.at ?? duration) && typeof line === 'string')),
    `${id} 字幕时间无效`);
    check(animations.every(event => ['shift', 'degree', 'tritone', 'feature'].includes(event.type) &&
      finite(event.at) && event.at >= 0 && finite(event.duration) && event.duration > 0 &&
      event.at + event.duration <= duration), `${id} 动画时间无效`);
    const resolvedBars = bars.map(bar => {
      const mode = modes[bar.mode ?? scene.mode];
      check(mode, `${id} 未知调式`);
      const chord = bar.chord ? parseChord(bar.chord) : null;
      const [min, max] = BOARD_RANGE;
      const chordPositions = new Map((chord ? guitarPositions(chord, min, max) : []).map(position => [key(position), position]));
      return { ...bar, chord, mode, positions: boardPositions(mode, chordPositions) };
    });
    const startFrame = frame;
    frame += frames;
    return { ...scene, bars: resolvedBars, beatSeconds, barSeconds, duration, startFrame, endFrame: frame, tracks, notes };
  });
  check(scenes.length > 0, '没有可渲染场景');
  return { ...project, scenes, frames: frame, duration: frame / project.fps };
}

function boardPositions(mode, chordPositions) {
  const positions = [];
  for (let string = 1; string <= 6; string++) {
    for (let fret = BOARD_RANGE[0]; fret <= BOARD_RANGE[1]; fret++) {
      const midi = midiAt(tuning, string, fret);
      const degree = mode.byPitch.get(pc(midi));
      const chordTone = chordPositions.get(key({ string, fret }));
      positions.push({ string, fret, midi, name: degree?.name ?? chordTone?.name ?? noteName(midi),
        tone: { interval: degree?.interval }, scale: Boolean(degree), chord: Boolean(chordTone) });
    }
  }
  return positions;
}

export function trackClip(track, scene, sourceDuration = scene.duration) {
  const start = Math.max(0, track.at);
  const offset = track.sourceIn + start - track.at;
  return { start, offset, end: Math.min(track.until ?? scene.duration, start + Math.max(0, sourceDuration - offset)) };
}

export function frameState(model, time, assets = {}) {
  const t = clamp(time, model.duration - 1e-8);
  const scene = model.scenes.find(item => t < item.endFrame / model.fps);
  const local = t - scene.startFrame / model.fps;
  const barIndex = Math.min(scene.bars.length - 1, Math.floor(local / scene.barSeconds));
  const bar = scene.bars[barIndex];
  const cue = scene.cues.findLast(item => item.at <= local);
  const asset = (track) => assets[track.key];
  const active = scene.notes.filter(note => {
    const source = asset(note.track);
    if (!source) return false;
    const clip = trackClip(note.track, scene, source.duration);
    return local >= Math.max(clip.start, note.at) && local < Math.min(clip.end, note.end);
  });
  const positions = bar.positions.map(position => {
    const known = active.find(note => note.hasPosition && note.string === position.string && note.fret === position.fret);
    const candidate = active.some(note => !note.hasPosition && note.midi === position.midi);
    return { ...position, known, candidate };
  }).filter(position => position.scale || position.chord || position.known || position.candidate);
  const usable = scene.tracks.filter(track => {
    const source = asset(track);
    return source && trackClip(track, scene, source.duration).end > trackClip(track, scene, source.duration).start;
  });
  const partial = usable.length < scene.tracks.length || usable.some(track =>
    trackClip(track, scene, asset(track).duration).end + 0.025 < (track.until ?? scene.duration));
  return { time: t, local, scene, bar, barIndex, beat: local / scene.beatSeconds, cue, positions,
    animations: scene.animations.filter(item => local >= item.at && local < item.at + item.duration),
    audioStatus: !usable.length ? 'WAV 缺失 · 静音预览' : partial ? '实录 WAV 部分就绪' : '创作者实录 WAV',
    noteStatus: !usable.length ? '' : !scene.notes.some(note => usable.includes(note.track))
      ? ' · 待导入演奏打点' : active.some(note => !note.hasPosition) ? ' · 音高候选位置' : '' };
}
