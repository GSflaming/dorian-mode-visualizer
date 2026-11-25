import { getVisualState } from './analysis.mjs';
import { floorIndex } from './timing.mjs';
import { display, pc } from './theory.mjs';
import { fretX, fullName, noteX, PRESETS } from './vendor/fret-note/music.mjs';
import { notesAt } from './performance-model.mjs';

export const frameWidth = 1920;
export const frameHeight = 1080;
const left = 128, right = 1792;
const ink = '#182132', quiet = '#626f83', hair = '#d8dfe9', pale = '#edf1f6';
const guitarBlue = '#205adc', keyTeal = '#087e82', bassInk = '#475d77';
const clamp = (n, min = 0, max = 1) => Math.min(max, Math.max(min, n));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const symbol = event => event ? display(event.chord.symbol) : '—';
const signed = n => n > 0 ? '+' + n : String(n).replace('-', '−');
const clock = seconds => {
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

function label(ctx, value, x, y, { size = 22, color = ink, weight = 500, align = 'left' } = {}) {
  ctx.font = `${Math.round(weight / 100) * 100} ${size}px Inter, "Helvetica Neue", "Hiragino Sans GB", Arial, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
}

function line(ctx, x, y, endX, endY, color = hair, width = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(endX, endY);
  ctx.stroke();
}

function dot(ctx, x, y, r, fill, stroke, width = 1) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
}

function bendAt(points, phase) {
  if (!points?.length) return 0;
  const index = floorIndex(points, phase, 'at');
  const a = points[index] ?? { at: 0, semitones: 0 };
  const b = points[index + 1];
  return b ? lerp(a.semitones, b.semitones, clamp((phase - a.at) / (b.at - a.at))) : a.semitones;
}

export function guitarGesture(note, time) {
  const { bend, slide, vibrato, sustain, mute } = note.techniques ?? {};
  const age = time - note.start;
  const duration = note.end - note.start;
  const phase = clamp(age / duration);
  const slideTime = Math.min(duration, slide?.seconds ?? .18);
  let fret = note.fret;
  if (slide?.fromFret != null) fret = lerp(slide.fromFret, fret, smooth(clamp(age / slideTime)));
  if (slide?.toFret != null) fret = lerp(fret, slide.toFret, smooth(clamp(1 - (duration - age) / slideTime)));
  const vibratoAge = age - (vibrato?.delay ?? 0);
  const oscillation = vibrato && vibratoAge > 0 ?
    vibrato.depth * Math.sin(vibratoAge * vibrato.rate * Math.PI * 2) * clamp(vibratoAge / .08) : 0;
  return { fret, bend: bendAt(bend, phase), oscillation, sustain, mute, age };
}

function drawHud(ctx, model, state, parts, noteSource) {
  const { title, artist } = model.song.songMetadata;
  label(ctx, title, left, 116, { size: 35, weight: 650 });
  if (artist) label(ctx, artist, left, 160, { size: 20, color: quiet });
  const statuses = [parts?.guitar.status, parts?.piano.status];
  const annotation = noteSource ?? (statuses.includes('estimated') ? '转录估计' : statuses.includes('draft') ? '谱面待校对' : '');
  if (annotation) label(ctx, annotation, left, 205, { size: 17, color: quiet });
  if (state.chord) {
    label(ctx, symbol(state.chord), 960, 158, { size: 72, weight: 640, align: 'center' });
    label(ctx, state.chord.chord.tones.map(tone => display(tone.name)).join('   '), 960, 219,
      { size: 22, color: quiet, align: 'center' });
  }
}

function drawBeat(ctx, model, state) {
  if (!state.position || state.position.bar < 1) return null;
  const { position } = state;
  const meter = model.timing.meters[Math.max(0, floorIndex(model.timing.meters, position.start, 'beat'))];
  const x = 1718, y = 152, r = 52;
  const step = position.pulse - 1;
  const angle = beat => beat / meter.numerator * Math.PI * 2 - Math.PI / 2;
  dot(ctx, x, y, r, null, hair, 1.25);
  for (let i = 0; i < meter.numerator; i++) {
    const a = angle(i);
    const down = i === 0;
    const radius = r - (down ? 5 : 2);
    const hot = i === Math.floor(step);
    dot(ctx, x + radius * Math.cos(a), y + radius * Math.sin(a), hot ? 4.3 : down ? 3.3 : 2.1, hot ? guitarBlue : quiet);
  }
  const a = angle(step);
  line(ctx, x, y, x + 37 * Math.cos(a), y + 37 * Math.sin(a), guitarBlue, 2);
  dot(ctx, x, y, 3, guitarBlue);
  label(ctx, `${meter.numerator}/${meter.denominator}`, x, 224, { color: quiet, size: 20, align: 'center' });
  return { numerator: meter.numerator, denominator: meter.denominator, pulse: position.pulse, bar: position.bar };
}

export function drawGuitar(ctx, time, part, active, chord, options) {
  const tuning = part?.tuning ?? PRESETS.standard.notes;
  const lastFret = part?.lastFret ?? 18;
  const x0 = options?.x ?? left;
  const nut = x0 + 45;
  const end = options ? x0 + options.width - 14 : right - 14;
  const [from, to] = options?.range ?? [0, lastFret];
  const worldLeft = fretX(Math.max(0, from - 1));
  const distance = (end - nut) / (fretX(to) - worldLeft);
  const wire = fret => nut + (fretX(fret) - worldLeft) * distance;
  const center = fret => fret === 0 ? wire(0) - 22 : nut + (noteX(fret) - worldLeft) * distance;
  const fretPosition = fret => lerp(center(Math.floor(fret)), center(Math.ceil(fret)), fret % 1);
  const top = options?.y ?? 332, bottom = top + (options?.height ?? 226);
  const y = string => lerp(top, bottom, (string - 1) / (tuning.length - 1));
  const stringPitch = (string, fret) => tuning[tuning.length - string] + fret;
  const rules = options?.palette ?? {};
  const bounds = x => x >= x0 + 10 && x <= end + .5;
  if (options) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0 - 4, top - 39, end - x0 + 24, bottom - top + 76);
    ctx.clip();
  }
  for (let fret = 0; fret <= lastFret; fret++) {
    if (options && !bounds(wire(fret))) continue;
    line(ctx, wire(fret), top, wire(fret), bottom, fret === 0 ? rules.nut ?? '#8995a8' : rules.hair ?? hair, fret === 0 ? 3 : 1.2);
  }
  for (let string = 1; string <= tuning.length; string++) {
    line(ctx, options ? Math.max(x0 + 31, wire(0)) : left, y(string), end, y(string), rules.string ?? '#b9c3d1', 1 + (string - 1) * .23);
    if (options) label(ctx, fullName(tuning[tuning.length-string]).slice(0,-1), x0 + 7, y(string),
      { size: 14, color: rules.quiet ?? quiet });
  }
  for (const fret of [3, 5, 7, 9, 12, 15, 17, 19, 21, 24].filter(fret => fret <= lastFret)) {
    if (options && !bounds(center(fret))) continue;
    label(ctx, String(fret), center(fret), bottom + (options ? 22 : 41), { size: 16, align: 'center', color: rules.quiet ?? quiet });
    if (!options) for (const offset of fret % 12 === 0 ? [-6, 6] : [0]) dot(ctx, center(fret) + offset, 577, 2.5, '#a8b3c4');
  }
  const tones = new Map(chord?.tones.map(tone => [tone.pc, tone]) ?? []);
  const sounding = new Set(active.map(note => `${note.string}:${note.fret}`));
  const references = new Map();
  for (const note of active.filter(note => !note.techniques?.mute)) {
    const focus = Math.round(guitarGesture(note, time).fret);
    for (let string = Math.max(1, note.string - 1); string <= Math.min(tuning.length, note.string + 1); string++) {
      for (let fret = Math.max(0, focus - 2); fret <= Math.min(lastFret, focus + 2); fret++) {
        const position = `${string}:${fret}`;
        if (!sounding.has(position) && tones.has(pc(stringPitch(string, fret)))) references.set(position, { string, fret });
      }
    }
  }
  if (options) {
    for (let string = 1; string <= tuning.length; string++) {
      for (let fret = 0; fret <= lastFret; fret++) {
        if (!bounds(center(fret)) || sounding.has(`${string}:${fret}`)) continue;
        const pitch = stringPitch(string, fret);
        const style = options.reference(pitch, tones.get(pc(pitch)));
        if (style) dot(ctx, center(fret), y(string), style.radius, style.fill, style.stroke, 1.4);
      }
    }
  } else {
    for (const { string, fret } of references.values()) dot(ctx, center(fret), y(string), 6, '#e1ebff', '#9db8ef');
  }
  const released = (options?.released ?? notesAt(part?.notes ?? [], time - .13)).filter(note => note.end <= time &&
    !sounding.has(`${note.string}:${note.fret}`) && !note.techniques?.mute);
  for (const note of released) {
    ctx.globalAlpha = .5 * clamp(1 - (time - note.end) / (options?.releaseWindow ?? .13));
    dot(ctx, center(note.fret), y(note.string), 13, null, options?.active?.(note.pitch, tones.get(pc(note.pitch))) ?? guitarBlue, 2);
  }
  ctx.globalAlpha = 1;
  for (const note of active) {
    const gesture = guitarGesture(note, time);
    const baseY = y(note.string);
    const x = fretPosition(gesture.fret);
    const dy = clamp(gesture.bend + gesture.oscillation, -2.8, 2.8) * 13;
    const playY = baseY - dy;
    const roundedPitch = note.pitch + Math.round(gesture.fret - note.fret + gesture.bend);
    const tone = tones.get(pc(roundedPitch));
    const accent = options?.active?.(roundedPitch, tone) ?? guitarBlue;
    if (gesture.mute) {
      dot(ctx, x, baseY, 13, '#f1f3f7', '#8694a8');
      label(ctx, '×', x, baseY - 1, { size: 19, color: bassInk, align: 'center' });
      continue;
    }
    if (note.techniques?.slide && Math.abs(x - center(note.fret)) > 2) {
      line(ctx, center(note.fret), baseY, x, baseY, accent, 3);
      dot(ctx, center(note.fret), baseY, 5, accent);
    }
    if (Math.abs(dy) > 1) {
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      ctx.quadraticCurveTo(x + 12, (baseY + playY) / 2, x, playY);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    const attack = 1 - clamp(gesture.age / .18);
    const radius = options ? 15 + attack * 3 : 16 + attack * 2;
    const palmMute = note.techniques?.palmMute;
    const halo = gesture.sustain ? 9 : palmMute ? 2 : 5;
    if (options) {
      ctx.globalAlpha = .19 + .1 * attack;
      dot(ctx, x, playY, radius + halo + attack * 10, accent);
      ctx.globalAlpha = 1;
    } else dot(ctx, x, playY, radius + halo + attack * 4, '#e7efff');
    dot(ctx, x, playY, radius, palmMute ? '#345889' : accent);
    const preferFlats = chord?.root.name.includes('b') || chord?.tones.some(tone => tone.pc === pc(roundedPitch) && tone.name.includes('b'));
    label(ctx, fullName(roundedPitch, preferFlats), x, playY, { size: 14, weight: 700, align: 'center', color: '#fff' });
    const degree = options ? options.degree(roundedPitch, tone) : tone?.interval;
    if (degree) label(ctx, display(degree), x + 25, playY - 13, { size: 13, weight: 650, color: options?.palette.ink ?? guitarBlue });
  }
  if (options) ctx.restore();
  return references.size;
}

export function drawKeys(ctx, time, notes, options) {
  const rowLeft = options?.left ?? left;
  const rowRight = options?.right ?? right;
  const hitX = options?.hitX ?? 960, midY = options?.y ?? 688, speed = options?.speed ?? 262;
  const y = pitch => midY + clamp(((options?.center ?? 64) - pitch) * (options?.pitchScale ?? 1.45), -52, 52);
  const barColor = options?.hair ?? pale;
  line(ctx, rowLeft, midY, rowRight, midY, barColor, 1.3);
  line(ctx, hitX, midY - 48, hitX, midY + 48, barColor, 1.3);
  if (!options) label(ctx, '键盘', left, midY - 23, { size: 18, color: quiet });
  const last = floorIndex(notes, time + (rowRight - hitX) / speed, 'start');
  for (let i = 0; i <= last; i++) {
    const note = notes[i];
    if (note.end <= time - (hitX - rowLeft) / speed) continue;
    const active = note.start <= time && time < note.end;
    const future = note.start > time;
    const head = clamp(hitX + (note.start - time) * speed, rowLeft + 6, rowRight - 4);
    const tail = clamp(hitX + (note.end - time) * speed, rowLeft + 6, rowRight - 4);
    const yy = y(note.pitch);
    const color = options?.color?.(note) ?? keyTeal;
    if (active) {
      line(ctx, head, yy, hitX, yy, options ? color : '#79c3c0', 3);
      line(ctx, hitX, yy, tail, yy, options ? color : '#add6d3', 2);
      if (options) {ctx.globalAlpha=.18;dot(ctx,hitX,yy,9,color);ctx.globalAlpha=1;}
      else dot(ctx, hitX, yy, 12, '#e1f1f0');
      dot(ctx, hitX, yy, 5, color);
    } else {
      ctx.globalAlpha = future ? .75 : .55 * clamp(1 - (time - note.end) / 2.8);
      line(ctx, head, yy, tail, yy, options ? color : '#add6d3', 1.7);
      dot(ctx, future ? head : tail, yy, 3, options ? color : '#64a6a7');
      ctx.globalAlpha = 1;
    }
  }
}

function drawBass(ctx, model, state) {
  const current = state.bass;
  const actual = model.track !== 'symbol';
  const title = actual ? '贝斯' : '符号低音';
  label(ctx, title, left, 789, { color: quiet, size: 18 });
  if (current) {
    const name = actual ? fullName(current.midi, current.name.includes('b') || current.name.includes('♭')) : display(current.name);
    label(ctx, name, left, 830, { size: 32, weight: 650, color: bassInk });
    const distance = current.delta == null ? '' : `${current.delta > 0 ? '↑' : current.delta < 0 ? '↓' : '→'} ${signed(current.delta)} st  ·  `;
    const length = current.run.pedal ? current.run.end - current.run.start : current.end - current.start;
    label(ctx, distance + length.toFixed(2) + ' s', left, 866, { size: 18, color: quiet });
  }
  const from = state.time - 6000 / 1432, to = from + 10;
  const x = t => lerp(360, right, clamp((t - from) / (to - from)));
  const heights = model.bass.filter(event => event.end > from && event.start < to);
  const center = actual ? 43 : current?.height ?? heights[0]?.height ?? 0;
  const maxDistance = Math.max(6, ...heights.map(event => Math.abs(event.height - center)));
  const y = height => 829 - (height - center) / (actual ? 23 : maxDistance) * 46;
  const cursor = x(state.time);
  line(ctx, cursor, 781, cursor, 881, hair, 1);
  for (const [i, event] of heights.entries()) {
    const previous = heights[i - 1];
    const yy = y(event.height);
    const start = x(event.start);
    const end = x(event.end);
    const accent = event === current || (current?.run === event.run && event.run.pedal);
    const color = accent ? bassInk : '#a5b2c2';
    if (previous && event.delta != null) line(ctx, start, y(previous.height), start, yy,
      Math.abs(event.delta) === 1 ? guitarBlue : color, Math.abs(event.delta) === 1 ? 2.5 : 1.5);
    line(ctx, start, yy, end, yy, color, event.run.pedal ? 3.5 : 2);
    if (event.run.pedal && event.start >= from && previous?.run !== event.run) dot(ctx, start, yy, 3.3, color);
  }
  if (current) dot(ctx, cursor, y(current.height), 5, bassInk, '#fff', 1.5);
  return current ? { name: current.name, midi: current.midi, delta: current.delta, pedal: current.run.pedal } : null;
}

function drawTimeline(ctx, model, state, showTension) {
  const width = right - left;
  const x = seconds => left + clamp(seconds / model.duration) * width;
  const y = 1027;
  line(ctx, left, y, right, y, hair, 1.4);
  const cursor = x(state.time);
  line(ctx, left, y, cursor, y, '#94b2e6', 1.6);
  dot(ctx, cursor, y, 4, guitarBlue);
  label(ctx, clock(state.time), left, 1000, { size: 19, color: quiet });
  label(ctx, clock(model.duration), right, 1000, { size: 19, color: quiet, align: 'right' });
  const local = seconds => 960 + (seconds - state.time) * 116;
  const row = 952;
  line(ctx, left, row, right, row, pale, 1.6);
  line(ctx, 960, row - 7, 960, row + 7, guitarBlue, 1.25);
  for (const event of model.events) {
    if (local(event.end) <= left || local(event.start) >= right) continue;
    const start = Math.max(left, local(event.start));
    const end = Math.min(right, local(event.end));
    const active = event === state.chord;
    line(ctx, start, row, Math.max(start, end - 2), row, active ? guitarBlue : '#b5c4da', active ? 4.3 : 2.5);
    if (end - start >= 48) label(ctx, symbol(event), (start + end) / 2, row + 22,
      { size: 16, color: active ? guitarBlue : quiet, align: 'center' });
  }
  if (!showTension || !model.tension.some(Boolean)) return;
  const valueY = value => 937 - value * .34;
  for (const [i, value] of model.tension.entries()) {
    if (!value) continue;
    const event = model.events[i];
    if (local(event.end) <= left || local(event.start) >= right) continue;
    const previous = model.events[i - 1];
    const yy = valueY(value.value);
    const start = Math.max(left, local(event.start));
    const color = event === state.chord ? '#6582b4' : '#b6c7dc';
    if (model.tension[i - 1] && local(event.start) >= left && Math.abs(previous.end - event.start) < 1e-5) {
      line(ctx, start, valueY(model.tension[i - 1].value), start, yy, color, 1.25);
    }
    line(ctx, start, yy, Math.min(right, local(event.end)), yy, color, 1.25);
  }
  if (state.tension) dot(ctx, 960, valueY(state.tension.value), 3.2, '#6582b4');
}

function drawMetrics(ctx, state) {
  const transition = state.transition;
  if (!transition) return;
  const metrics = transition.metrics;
  const matched = metrics?.moves.filter(move => move.semitones !== null).length ?? 0;
  const values = [`共同音 ${transition.commonClasses.length}`];
  if (metrics) values.push(`总位移 ${metrics.total}`, `平均 ${matched ? (metrics.total / matched).toFixed(1) : '—'}`,
    `最大 ${metrics.max}`, `交叉 ${metrics.crossing.length}`);
  if (state.tension) values.push(`张力 ${state.tension.value.toFixed(0)}`);
  label(ctx, values.join('   ·   '), 960, 265, { size: 17, align: 'center', color: quiet });
}

export function preparePresentationParts(parts) {
  if (!parts) return null;
  const guitar = parts.guitar;
  return {
    ...parts,
    guitar: { ...guitar, lastFret: guitar.notes.reduce((last, note) =>
      Math.max(last, note.fret, note.techniques?.slide?.fromFret ?? 0, note.techniques?.slide?.toFret ?? 0), 18) },
    piano: { ...parts.piano, notes: [...parts.piano.notes].sort((a, b) => a.start - b.start) },
  };
}

export function drawPresentation(canvas, model, time, parts, { tension = false, metrics = false, noteSource } = {}) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const state = getVisualState(model, time);
  const active = notesAt(parts?.guitar.notes ?? [], state.time);
  const keys = parts?.piano.notes ?? [];
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, frameWidth, frameHeight);
  drawHud(ctx, model, state, parts, noteSource);
  const beat = drawBeat(ctx, model, state);
  if (metrics) drawMetrics(ctx, state);
  const references = drawGuitar(ctx, state.time, parts?.guitar, active, state.chord?.chord);
  drawKeys(ctx, state.time, keys);
  const bass = drawBass(ctx, model, state);
  drawTimeline(ctx, model, state, tension);
  return {
    chord: state.chord?.chord.symbol ?? null, time: state.time, beat, bass, references,
    guitar: active.map(note => ({ string: note.string, fret: note.fret, pitch: note.pitch, ...guitarGesture(note, state.time) })),
    keys: [...new Set(notesAt(keys, state.time).map(note => note.pitch))].sort((a, b) => a - b),
  };
}
