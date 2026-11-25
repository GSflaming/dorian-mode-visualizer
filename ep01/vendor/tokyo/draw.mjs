import { fretX, noteX, rangeCamera, fullName, noteName } from './vendor/fret-note/music.mjs';
import { display, tuning } from './theory.mjs';
import { statusName } from './data.mjs';

export const colors = {
  ink: '#111827', muted: '#64748B', line: '#DCE1E8', accent: '#2563EB',
  held: '#64748B', up: '#2563EB', down: '#D97706',
};
const W = 1380;
const M = 22;
const X = W - M;
const font = (size, weight = 500) => `${weight} ${size}px -apple-system, "PingFang SC", "Hiragino Sans GB", Arial, sans-serif`;

function start(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  return ctx;
}
function label(ctx, text, x, y, { color = colors.ink, size = 14, align = 'left', weight = 500, maxWidth } = {}) {
  ctx.fillStyle = color;
  ctx.font = font(size, weight);
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (maxWidth !== undefined) ctx.fillText(text, x, y, maxWidth);
  else ctx.fillText(text, x, y);
}
function line(ctx, x0, y0, x1, y1, color, width = 1) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}
function dot(ctx, x, y, radius, color) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

const positionId = ({ string, fret }) => string + ':' + fret;
const clamp = (number, min = 0, max = 1) => Math.max(min, Math.min(max, number));
const ease = (value) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};

// Presentation uses the transport timestamp, including on seeks and exported frames.
export function chordFade(state) {
  const { chord, previous, next, time } = state;
  if (!chord) return { opacity: 1, mix: 1, previous: null };
  const adjacent = previous && Math.abs(previous.end - chord.start) < 1e-7;
  const duration = chord.end - chord.start;
  const mix = adjacent ? ease((time - chord.start) / Math.min(.20, duration * .65)) : 1;
  const enter = adjacent ? ease((time - chord.start) / Math.min(.13, duration * .43)) : 1;
  const exit = next && Math.abs(chord.end - next.start) < 1e-7 ?
    ease((chord.end - time) / Math.min(.08, duration * .35)) : 1;
  return { opacity: .46 + Math.min(enter, exit) * .54, mix, previous: adjacent ? previous : null };
}

function noteColor(tone) {
  if (tone?.role === 'root') return colors.ink;
  if (!tone || tone.degree > 7 && /[b#]/.test(tone.interval) ||
      tone.degree === 5 && tone.interval !== '5') return colors.down;
  return colors.accent;
}

export function drawBoard(canvas, state, range, intervals, fade, showPaths, presentation) {
  const ctx = start(canvas);
  const [min, max] = range;
  const camera = rangeCamera(min, max);
  const left = 79;
  const right = W - 26;
  const scale = (right - left) / (camera.right - camera.left);
  const world = (value) => left + (value - camera.left) * scale;
  const x = (fret) => fret ? world(noteX(fret)) : left - 23;
  const y = (string) => 39 + (string - 1) * 39;
  const startX = min > 1 ? world(fretX(min - 1)) : world(fretX(0));
  const endX = world(fretX(max));
  for (let fret = Math.max(0, min - 1); fret <= max; fret++) {
    const boundary = world(fretX(fret));
    line(ctx, boundary, y(1), boundary, y(6), fret === 0 ? '#9CA8B8' : '#DEE3EA', fret === 0 ? 2 : 1);
    if (fret >= min) label(ctx, String(fret), x(fret), 13, { align: 'center', size: 13, color: colors.muted });
  }
  for (let string = 1; string <= 6; string++) {
    label(ctx, noteName(tuning[6 - string]), 22, y(string), { align: 'center', size: 14, color: colors.muted });
    line(ctx, startX, y(string), endX, y(string), '#B6C0CC', .8 + string * .12);
  }
  const previous = fade.mix < 1 && fade.previous ?
    (state.layer === 'theory' ? fade.previous.positions : fade.previous.layers[state.layer]?.positions ?? []) : [];
  const before = new Set(previous.map(positionId));
  const current = new Set(state.positions.map(positionId));
  const bounds = (position) => position.fret >= min && position.fret <= max;
  if (showPaths && state.layer === 'recording' && state.progress < 1) {
    for (const move of state.transition?.metrics?.moves ?? []) {
      const { from, to } = move;
      if (!from?.string || !to?.string || !bounds(from) || !bounds(to) || positionId(from) === positionId(to)) continue;
      const progress = state.progress;
      ctx.globalAlpha = .72 * (1 - progress);
      line(ctx, x(from.fret), y(from.string), x(from.fret) + progress * (x(to.fret) - x(from.fret)),
        y(from.string) + progress * (y(to.string) - y(from.string)), colors[move.kind], 1.6);
    }
    ctx.globalAlpha = 1;
  }
  function drawNote(position, opacity) {
    const xx = x(position.fret);
    const yy = y(position.string);
    const cell = position.fret ? world(fretX(position.fret)) - world(fretX(position.fret - 1)) : 38;
    const style = presentation?.marker?.(position) ?? {};
    const radius = Math.max(8, Math.min(15, cell * .39)) * (style.scale ?? 1);
    const note = intervals ? position.tone?.interval ?? '—' :
      position.name?.replace(/-?\d+$/, '') ?? noteName(position.midi);
    ctx.globalAlpha = opacity * (style.opacity ?? 1);
    dot(ctx, xx, yy, radius, style.fill ?? noteColor(position.tone));
    if (style.stroke) {
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    if (style.label !== false) label(ctx, display(note), xx, yy + .4, {
      size: radius < 11 ? 10 : 13, weight: 670, color: style.ink ?? 'white', align: 'center', maxWidth: radius * 1.66,
    });
    ctx.globalAlpha = 1;
    return { x: xx, y: yy, radius: radius + 5, position };
  }
  for (const position of previous) {
    if (bounds(position) && !current.has(positionId(position))) drawNote(position, .52 * (1 - fade.mix));
  }
  presentation?.behindMarkers?.(ctx, (position) => ({ x: x(position.fret), y: y(position.string) }));
  return state.positions.filter(bounds).map(position =>
    drawNote(position, before.has(positionId(position)) ? 1 : .36 + .64 * fade.mix));
}

export function drawVoices(canvas, state, detailed) {
  const ctx = start(canvas);
  const { width, height } = canvas;
  const transition = state.transition;
  const metrics = transition?.metrics;
  if (!metrics) {
    label(ctx, transition ? '缺少可匹配的声部' : '等待相邻和弦', width / 2, height / 2,
      { color: colors.muted, align: 'center', size: 14 });
    return;
  }
  const pitches = [...new Set([...transition.before, ...transition.after].map(voice => voice.midi))].sort((a, b) => b - a);
  const y = (pitch) => pitches.length === 1 ? height / 2 :
    25 + pitches.indexOf(pitch) * (height - 50) / (pitches.length - 1);
  const x0 = 64;
  const x1 = width - 64;
  for (const [i, move] of metrics.moves.entries()) {
    const { from, to, kind } = move;
    const color = colors[kind] ?? colors.muted;
    if (from && to) {
      const y0 = y(from.midi);
      const y1 = y(to.midi);
      line(ctx, x0, y0, x1, y1, color, kind === 'held' ? .8 : 1.35);
      const progress = kind === 'held' ? .5 : state.progress;
      dot(ctx, x0 + (x1 - x0) * progress, y0 + (y1 - y0) * progress, 3.4, color);
      if (detailed && kind !== 'held') {
        const anchor = .28 + (i % 4) * .145;
        label(ctx, signed(move.semitones), x0 + (x1 - x0) * anchor, y0 + (y1 - y0) * anchor - 9,
          { color, align: 'center', size: 11 });
      }
    } else {
      ctx.globalAlpha = from ? 1 - state.progress * .65 : .35 + state.progress * .65;
      dot(ctx, from ? x0 : x1, y((from ?? to).midi), 3, colors.muted);
      ctx.globalAlpha = 1;
    }
    if (detailed && pitches.length <= 12) {
      if (from) label(ctx, display(from.name), x0 - 9, y(from.midi), { size: 11, align: 'right' });
      if (to) label(ctx, display(to.name), x1 + 9, y(to.midi), { size: 11 });
    }
  }
}

export const signed = (number) => number > 0 ? '+' + number : String(number).replace('-', '−');
export const formatTime = (time, fine = false) => {
  const units = fine ? Math.round(time * 100) : Math.floor(time);
  const second = fine ? Math.floor(units / 100) : units;
  return `${Math.floor(second / 60)}:${String(second % 60).padStart(2, '0')}${fine ? '.' + String(units % 100).padStart(2, '0') : ''}`;
};
export const timelineX = (view, seconds, width = W) => M + (seconds - view.start) / (view.end - view.start) * (width - 2 * M);
export const timelineTime = (view, x) => view.start + (x - M) / (X - M) * (view.end - view.start);
const clampX = (x, width = W) => clamp(x, M, width - M);
function playhead(ctx, state, view, y0, y1, width = W) {
  const x = timelineX(view, state.time, width);
  if (x >= M - .001 && x <= width - M + .001) line(ctx, x, y0, x, y1, colors.accent, 1.6);
}

export function drawTimeline(canvas, state, model, view, loop, dragging, editing) {
  const ctx = start(canvas);
  const x = (seconds) => timelineX(view, seconds);
  const playX = x(state.time);
  const rail = editing ? 68 : 48;
  const weight = editing ? 1.5 : 3.4;
  line(ctx, M, rail, X, rail, colors.line, weight);
  if (playX >= M) line(ctx, M, rail, Math.min(X, playX), rail, colors.accent, weight);
  if (loop && loop.end > view.start && loop.start < view.end) {
    line(ctx, clampX(x(loop.start)), rail + 10, clampX(x(loop.end)), rail + 10, '#93B5FF', weight);
  }
  if (playX >= M - .001 && playX <= X + .001) {
    if (editing) playhead(ctx, state, view, 23, 75);
    else {
      ctx.beginPath();
      ctx.ellipse(playX, rail, 5.7, 14.8, 0, 0, Math.PI * 2);
      ctx.fillStyle = colors.accent;
      ctx.fill();
    }
  }
  if (!editing) return;
  for (const section of model.sections) {
    if (section.end <= view.start || section.start >= view.end) continue;
    const left = clampX(x(section.start));
    const right = clampX(x(section.end));
    line(ctx, left + 1, 19, right - 1, 19, colors.line);
    if (right - left > 50) label(ctx, section.name, left + 4, 9, { size: 13, color: colors.muted, maxWidth: right - left - 8 });
  }
  for (const event of model.events) {
    const time = dragging?.event.id === event.id ? dragging : event;
    if (time.end <= view.start || time.start >= view.end) continue;
    const left = clampX(x(time.start));
    const right = clampX(x(time.end));
    const active = event === state.chord || time === dragging;
    const color = active ? colors.accent : '#9AA6B5';
    line(ctx, left + 1, 55, right - 1, 55, color, active ? 2.2 : 1);
    line(ctx, left, 50, left, 58, color);
    if (right - left > 23) label(ctx, display(event.chord.symbol), (left + right) / 2, 40,
      { size: 16, align: 'center', weight: active ? 700 : 500, maxWidth: right - left - 6 });
  }
  if (model.song.audioMetadata.calibrated) {
    const grid = model.timing.grid(model.timing.beat(view.start), model.timing.beat(view.end));
    let last = -Infinity;
    for (const mark of grid) {
      const xx = x(model.timing.seconds(mark.beat));
      const bar = mark.pulse === 1;
      if (!bar && view.end - view.start > 36) continue;
      line(ctx, xx, 70, xx, bar ? 80 : 75, colors.line);
      if (bar && xx - last > 55) {
        label(ctx, String(mark.bar), xx + 2, 90, { color: colors.muted, size: 13 });
        last = xx;
      }
    }
  }
}

export function drawBass(canvas, state, model, view) {
  const ctx = start(canvas);
  const { width } = canvas;
  const events = model.bass.filter(event => event.end > view.start && event.start < view.end);
  if (!events.length) {
    label(ctx, '此区间无低音数据', width / 2, 35, { color: colors.muted, align: 'center', size: 14 });
    return;
  }
  const min = Math.min(...events.map(event => event.height));
  const max = Math.max(...events.map(event => event.height));
  const y = (height) => max === min ? 37 : 62 - (height - min) / (max - min) * 40;
  const x = (seconds) => clampX(timelineX(view, seconds, width), width);
  for (const [i, event] of events.entries()) {
    const x0 = x(event.start);
    const x1 = x(event.end);
    const yy = y(event.height);
    const color = event.delta === -1 ? colors.down : event.run.pedal ? colors.ink : colors.accent;
    line(ctx, x0, yy, x1, yy, color, 1.6);
    if (i && event.delta) line(ctx, x0, y(events[i - 1].height), x0, yy, color, 1.2);
    if (x1 - x0 > 28 && (!i || events[i - 1].run !== event.run)) {
      label(ctx, display(event.name), x0 + 4, yy - 11, { color, size: 12 });
    }
  }
  playhead(ctx, state, view, 6, 67, width);
}

export function drawTension(canvas, state, model, view) {
  const ctx = start(canvas);
  const { width } = canvas;
  const x = (seconds) => clampX(timelineX(view, seconds, width), width);
  line(ctx, M, 58, width - M, 58, colors.line);
  let previous;
  for (const [i, event] of model.events.entries()) {
    const value = model.tension[i]?.value;
    if (value == null || event.end <= view.start || event.start >= view.end) { previous = null; continue; }
    const x0 = x(event.start);
    const x1 = x(event.end);
    const y = 58 - value * .49;
    line(ctx, x0, y, x1, y, colors.accent, 1.7);
    if (previous && Math.abs(previous.end - event.start) < 1e-7) line(ctx, x0, previous.y, x0, y, colors.accent, 1.3);
    previous = { end: event.end, y };
  }
  playhead(ctx, state, view, 6, 64, width);
}

export function describeBarRange(timing, start, end) {
  const position = beat => {
    const { bar, pulse } = timing.position(beat);
    return `${bar} 小节 ${Number(pulse.toFixed(2))} 拍`;
  };
  return position(start) + ' → ' + position(end);
}

export const describeEvent = (event) => event ?
  `${display(event.chord.symbol)} · 拍位 ${event.startBeat.toFixed(2)}–${event.endBeat.toFixed(2)} · ${statusName[event.status]}` : '';
export const describeNote = ({ position }) =>
  `${display(position.name ?? fullName(position.midi))} · ${position.tone ? display(position.tone.interval) : '配置音'} · ${position.string} 弦 ${position.fret} 品 · MIDI ${position.midi}`;
