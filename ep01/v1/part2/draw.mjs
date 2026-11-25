import { lessons, songs, tuning } from './lesson.mjs';
import { display, parseChord, parseNote, pc, spelledPitch } from '../vendor/dream-theater/theory.mjs';
import { guitarGesture } from '../vendor/dream-theater/presentation.mjs';
import { notesAt } from '../vendor/dream-theater/performance-model.mjs';
import { fretX, fullName, noteX } from '../vendor/dream-theater/vendor/fret-note/music.mjs';

const lessonsMap = new Map(lessons.map((l) => [l.id, l]));

const left = 128, right = 1792;

// Dark Side of the Moon obsidian & prism-spectrum palette
const bg = '#0d1219';
const milk = '#f3eddc';
const muted = '#9db0b8';
const wire = '#2e3b47';
const rail = '#1f2832';
const keyWhite = '#232e38';
const keyWhiteStroke = '#3c4c59';
const keyBlack = '#06090e';
const keyBlackStroke = '#2c3742';

const frost = '#7fe3ea';   // Melody (synth / vocal / slide) & Dorian tonic focus
const amber = '#cf9246';   // Harmony (piano / organ / echo)
const gold = '#ffd080';    // Dorian characteristic natural 6th (C# / B / E)
const violet = '#d5a4eb';  // Chromatic pitch outside Dorian (C / F / Bb / Eb / Db)
const blue = '#5b8ef5';    // Guitar active fret & beat hand

const dorianSteps = [0, 2, 3, 5, 7, 9, 10];
const spectrumColors = [
  '#e06c65', // 1
  '#df935f', // 2
  '#d1b96b', // b3
  '#74b58f', // 4
  '#6ca6cc', // 5
  gold,      // nat6 (signature Dorian gold)
  frost,     // b7 (contrasts right beside nat6)
];
const scaleDegrees = ['1', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♭6', '♮6', '♭7', '7'];
const blackKeys = new Set([1, 3, 6, 8, 10]);
const hitX = left + 211, scrollSpeed = 235;
const timeX = (eventSec, nowSec) => hitX + (eventSec - nowSec) * scrollSpeed;

function modalAccent(pitch, tonic, mode) {
  const step = pc(pitch - tonic);
  if (mode === 'dorian' && step === 9) return gold;
  if (mode === 'chromatic' && !dorianSteps.includes(step)) return violet;
  return null;
}

function toneName(pitch, tonic, chord) {
  const tone = chord?.tones.find((t) => t.pc === pc(pitch));
  const name = tone ? display(spelledPitch(tone, pitch)) : fullName(pitch, tonic !== 4);
  const step = pc(pitch - tonic);
  return [8, 9].includes(step) ? name.replace(/^([A-G])(?=\d)/, '$1♮') : name;
}

const clamp = (n, min = 0, max = 1) => Math.min(max, Math.max(min, n));
const lerp = (a, b, t) => a + (b - a) * t;
const clockStr = (seconds) => {
  const total = Math.floor(Math.max(0, seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

function labelWidth(ctx, value, size = 22, weight = 500) {
  if (!value) return 0;
  const w = Math.round(weight / 100) * 100;
  const mainFont = `${w} ${size}px "Hiragino Sans GB", "Noto Sans CJK SC", Inter, sans-serif`;
  const symFont = `400 ${size}px "Apple Symbols", "DejaVu Sans", sans-serif`;
  let total = 0;
  for (const text of String(value).split(/([♮♭♯↔→×−]+)/u).filter(Boolean)) {
    ctx.font = /^[♮♭♯↔→×−]/u.test(text) ? symFont : mainFont;
    total += ctx.measureText(text).width;
  }
  return total;
}

function label(ctx, value, x, y, { size = 22, color = milk, weight = 500, align = 'left', maxWidth } = {}) {
  if (!value) return;
  const w = Math.round(weight / 100) * 100;
  const mainFont = `${w} ${size}px "Hiragino Sans GB", "Noto Sans CJK SC", Inter, sans-serif`;
  const symFont = `400 ${size}px "Apple Symbols", "DejaVu Sans", sans-serif`;
  const runs = String(value).split(/([♮♭♯↔→×−]+)/u).filter(Boolean).map((text) => {
    const font = /^[♮♭♯↔→×−]/u.test(text) ? symFont : mainFont;
    ctx.font = font;
    return { text, font, width: ctx.measureText(text).width };
  });
  const total = runs.reduce((sum, r) => sum + r.width, 0);
  const scale = maxWidth ? Math.min(1, maxWidth / Math.max(1, total)) : 1;
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = color;
  const startX = align === 'center' ? x - (total * scale) / 2 : align === 'right' ? x - total * scale : x;
  ctx.translate(startX, y);
  ctx.scale(scale, 1);
  let cursor = 0;
  for (const run of runs) {
    ctx.font = run.font;
    ctx.fillText(run.text, cursor, 0);
    cursor += run.width;
  }
  ctx.restore();
}

function line(ctx, x, y, endX, endY, color = wire, width = 1) {
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

function toPresentationGuitar(e, offsetMs) {
  const start = (e.startMs + offsetMs) / 1000;
  const end = (e.endMs + offsetMs) / 1000;
  const tech = {};
  const t = e.techniques;
  if (t?.bend) {
    if (Array.isArray(t.bend)) tech.bend = t.bend;
    else if (t.bend.points?.length) tech.bend = t.bend.points.map((p) => ({ at: clamp(p.position / 60), semitones: p.tone / 50 }));
    else if (t.bend.tone) tech.bend = [{ at: 0, semitones: 0 }, { at: 0.5, semitones: t.bend.tone / 50 }, { at: 1, semitones: t.bend.tone / 50 }];
  }
  if (t?.vibrato) tech.vibrato = { depth: 0.22, rate: 5.5, delay: 0.08 };
  if (t?.slide) tech.slide = typeof t.slide === 'object' ? { ...t.slide, seconds: 0.14 } : { toFret: Math.max(0, e.fret - 1), seconds: 0.14 };
  return { start, end, pitch: e.midi ?? e.pitch, string: e.string, fret: e.fret, techniques: Object.keys(tech).length ? tech : undefined };
}

function buildSceneCache(s, studyEvents) {
  const shiftMs = s.startMs - (s.audio?.sourceInMs ?? 0);
  const l = lessonsMap.get(s.study) ?? {
    barStartsMs: s.bars?.length
      ? [...s.bars.map((bar) => bar.startMs - shiftMs), s.bars.at(-1).endMs - shiftMs]
      : undefined,
  };
  const raw = s.excerptId ? studyEvents.filter((event) => event.excerptId === s.excerptId) : [];

  const guitarNotes = raw
    .filter((e) => e.part === 'guitar' && e.string && e.startMs !== null)
    .map((e) => toPresentationGuitar(e, shiftMs))
    .sort((a, b) => a.start - b.start);

  const keyNotes = raw
    .filter((e) => ['piano', 'synth', 'organ', 'vocal', 'echo', 'steel'].includes(e.part) && e.startMs !== null)
    .map((e) => ({
      start: (e.startMs + shiftMs) / 1000,
      end: (e.endMs + shiftMs) / 1000,
      pitch: e.midi,
      part: e.part,
      role: e.role ?? (['synth', 'vocal'].includes(e.part) ? 'melody' : 'harmony'),
    }))
    .sort((a, b) => a.start - b.start);

  // Split held notes at harmonic boundaries so approaching notes already show their
  // destination colour. Keep labels and highlights tied to the original sustain.
  const tonic = parseNote(s.tonic ?? songs[l.song]?.tonicName ?? 'D').pc;
  const chords = new Map(s.harmony.map((h) => [h.symbol, parseChord(h.symbol)]));
  const intervals = [];
  let cursor = s.startMs;
  for (const h of s.harmony) {
    if (cursor < h.startMs) intervals.push({ startMs: cursor, endMs: h.startMs });
    intervals.push(h);
    cursor = h.endMs;
  }
  if (cursor < s.endMs) intervals.push({ startMs: cursor, endMs: s.endMs });
  const keySpans = [];
  for (const h of intervals) {
    const chord = chords.get(h.symbol);
    for (const n of keyNotes) {
      const start = Math.max(n.start, h.startMs / 1000), end = Math.min(n.end, h.endMs / 1000);
      if (end <= start) continue;
      const accent = modalAccent(n.pitch, tonic, h.mode);
      keySpans.push({
        ...n,
        start,
        end,
        attack: n.start === start,
        accent,
        color: accent ?? (n.role === 'melody' ? frost : amber),
        name: toneName(n.pitch, tonic, chord),
      });
    }
  }
  // Paint the melody last when a harmony or an echo doubles its pitch.
  keySpans.sort((a, b) => Number(a.role === 'melody') - Number(b.role === 'melody'));
  const pitches = keySpans.map((n) => n.pitch);
  let low = pitches.length ? Math.min(...pitches) - 1 : 48;
  let high = pitches.length ? Math.max(...pitches) + 1 : 72;
  if (blackKeys.has(pc(low))) low--;
  if (blackKeys.has(pc(high))) high++;
  const maxFret = guitarNotes.reduce(
    (m, n) => Math.max(m, n.fret, n.techniques?.slide?.fromFret ?? 0, n.techniques?.slide?.toFret ?? 0),
    17,
  );
  return { l, guitar: { notes: guitarNotes, lastFret: Math.min(22, Math.max(17, maxFret)) }, keys: { spans: keySpans, low, high }, chords, tonic };
}

function drawBeatClock(ctx, sourceMs, lesson) {
  const x = 1750, y = 140, r = 41;
  const bars = lesson.barStartsMs;
  if (!bars?.length) return;
  const i = clamp(bars.findLastIndex((ms) => ms <= sourceMs), 0, bars.length - 2);
  const beats = lesson.song === 'gig' && lesson.firstMeasure + i === 39 ? 2 : 4;
  const beatFloat = beats * clamp((sourceMs - bars[i]) / (bars[i + 1] - bars[i]));
  const angle = (b) => (b / beats) * Math.PI * 2 - Math.PI / 2;
  dot(ctx, x, y, r, '#111822', '#3a4a56', 1.3);
  for (let b = 0; b < beats; b++) {
    const a = angle(b);
    const hot = b === Math.floor(beatFloat);
    dot(ctx, x + (r - (b === 0 ? 5 : 2)) * Math.cos(a), y + (r - (b === 0 ? 5 : 2)) * Math.sin(a), hot ? 4.4 : b === 0 ? 3.2 : 2.1, hot ? frost : '#687985');
  }
  const a = angle(beatFloat);
  line(ctx, x, y, x + 29 * Math.cos(a), y + 29 * Math.sin(a), frost, 2.2);
  dot(ctx, x, y, 3.2, frost);
  label(ctx, beats + '/4', x, 198, { color: muted, size: 18, align: 'center' });
}

function drawPrismHeader(ctx, s, l, tonic, parsedChord, h, soundingPcs) {
  const flats = tonic !== 4;
  const stepName = (step) => {
    const raw = fullName(tonic + step + 60, flats).slice(0, -1);
    return [8, 9].includes(step) ? raw.replace(/^([A-G])$/, '$1♮') : raw;
  };
  const mode = h?.mode ?? 'dorian';
  const sixPc = pc(tonic + 9);

  // Left: Song title, mode summary, current chord & signature voice-leading motion
  label(ctx, s.title, left, 70, { size: 38, weight: 650, color: milk, maxWidth: 550 });
  label(ctx, l.subtitle ?? '', left, 114, { size: 20, weight: 500, color: muted, maxWidth: 550 });

  if (parsedChord) {
    const hasSixth = parsedChord.tones.some((tone) => tone.pc === sixPc);
    const chordColor = mode === 'chromatic' ? violet : hasSixth ? gold : frost;
    const sym = display(parsedChord.symbol);
    label(ctx, sym, left, 184, { size: 64, weight: 700, color: chordColor });
    const symW = labelWidth(ctx, sym, 64, 700);
    const infoX = Math.min(470, left + symW + 28);

    const motion = {
      A7: tonic === 4 ? 'C♯ · 自然六级' : null,
      Cmaj7: tonic === 4 ? 'C♯ → C♮ · ♭6 离开 Dorian' : null,
      G7: tonic === 2 ? 'C → B♮ · 自然六级' : null,
      Bbmaj7: tonic === 2 ? 'B♮ → B♭ · ♭6 离开 Dorian' : null,
      C9: tonic === 7 ? 'F4 → E♮4 · 自然六级' : null,
      'Gm7/D': tonic === 7 ? '低音 D → D♭ · 离开 Dorian' : null,
      'Gm7b5/Db': tonic === 7 ? '低音 D → D♭ · 离开 Dorian' : null,
    }[h?.symbol];

    let detail = motion;
    if (!detail) {
      if (mode === 'chromatic') {
        const outside = parsedChord.tones.filter((n) => !dorianSteps.includes(pc(n.pc - tonic)));
        const changes = outside.map((n) => display(n.name)).join(' ');
        detail = [h?.label, changes && '调外音 ' + changes].filter(Boolean).join(' · ') || '离开 Dorian';
      } else {
        detail = hasSixth ? '自然六级构成大四级' : (h?.label ?? 'Dorian 主和弦 · 维持中心');
      }
    }
    label(ctx, detail, infoX, 168, { size: 23, weight: 600, color: chordColor, maxWidth: 685 - infoX });
    label(ctx, parsedChord.tones.map((tone) => display(tone.name)).join('   '), infoX, 204, { size: 19, color: muted, maxWidth: 685 - infoX });
  }

  // Center-Right: Dark Side Glass Prism + 7-Degree Dorian Spectrum
  const apex = [970, 40], bl = [856, 228], br = [1080, 228];
  const entryPt = [912, 136], exitPt = [1026, 137];

  // Incident white ray with soft halo
  ctx.save();
  ctx.globalAlpha = 0.16;
  line(ctx, 705, 192, entryPt[0], entryPt[1], milk, 8.5);
  ctx.globalAlpha = 0.92;
  line(ctx, 705, 192, entryPt[0], entryPt[1], milk, 2.6);
  ctx.restore();

  // Glass prism body
  const glass = ctx.createLinearGradient(bl[0], bl[1], br[0], apex[1]);
  glass.addColorStop(0, '#121b24');
  glass.addColorStop(0.55, '#22323c');
  glass.addColorStop(1, '#0f161f');
  ctx.fillStyle = glass;
  ctx.beginPath();
  ctx.moveTo(apex[0], apex[1]);
  ctx.lineTo(br[0], br[1]);
  ctx.lineTo(bl[0], bl[1]);
  ctx.closePath();
  ctx.fill();

  // Internal white dispersion bridge
  ctx.save();
  ctx.globalAlpha = 0.72;
  line(ctx, entryPt[0], entryPt[1], exitPt[0], exitPt[1], '#c9d7d4', 1.8);
  ctx.restore();

  // Crisp prism edges
  ctx.strokeStyle = '#82959c';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(bl[0], bl[1]);
  ctx.lineTo(apex[0], apex[1]);
  ctx.lineTo(br[0], br[1]);
  ctx.closePath();
  ctx.stroke();

  // 7 Dorian scale-degree rays lighting up in real time as instruments sound them
  dorianSteps.forEach((step, i) => {
    const ry = 48 + i * 28;
    const pitchClass = pc(tonic + step);
    const isSixth = step === 9;
    const isSounding = soundingPcs.has(pitchClass);
    const col = spectrumColors[i];
    const kX = 1146, kY = exitPt[1] + (ry - exitPt[1]) * 0.23, tipX = 1564;

    ctx.save();
    if (isSounding) {
      ctx.globalAlpha = isSixth && mode === 'dorian' ? 0.26 : 0.17;
      ctx.beginPath();
      ctx.moveTo(exitPt[0], exitPt[1]);
      ctx.lineTo(kX, kY);
      ctx.lineTo(tipX, ry);
      ctx.strokeStyle = col;
      ctx.lineWidth = isSixth && mode === 'dorian' ? 9 : 6.5;
      ctx.stroke();
    }
    ctx.globalAlpha = isSounding ? 1 : (isSixth && mode === 'dorian' ? 0.44 : 0.26);
    ctx.beginPath();
    ctx.moveTo(exitPt[0], exitPt[1]);
    ctx.lineTo(kX, kY);
    ctx.lineTo(tipX, ry);
    ctx.strokeStyle = col;
    ctx.lineWidth = isSounding ? (isSixth && mode === 'dorian' ? 3.5 : 2.9) : 1.4;
    ctx.stroke();

    ctx.globalAlpha = isSounding ? 1 : 0.62;
    label(ctx, stepName(step), tipX + 18, ry, {
      size: isSounding ? 22 : 20,
      weight: isSounding || isSixth ? 700 : 500,
      color: col,
    });
    if (isSixth) {
      label(ctx, '♮6', tipX + 64, ry, { size: 17, weight: 700, color: mode === 'dorian' ? gold : muted });
    }
    ctx.restore();
  });

  // When leaving Dorian, show the chromatic excursion ray fanning out in prism violet
  if (mode === 'chromatic' && parsedChord) {
    const outsideTones = parsedChord.tones.filter((n) => !dorianSteps.includes(pc(n.pc - tonic)));
    const outsideSounding = [...soundingPcs].filter((p) => !dorianSteps.includes(pc(p - tonic)));
    const showPcs = outsideTones.length ? outsideTones.map((t) => display(t.name)) : outsideSounding.map((p) => fullName(60 + p, flats).slice(0, -1));
    if (showPcs.length) {
      const ry = 244, kX = 1146, kY = exitPt[1] + (ry - exitPt[1]) * 0.23, tipX = 1564;
      const lit = outsideSounding.length > 0;
      ctx.save();
      ctx.globalAlpha = lit ? 0.22 : 0.1;
      ctx.beginPath();
      ctx.moveTo(exitPt[0], exitPt[1]);
      ctx.lineTo(kX, kY);
      ctx.lineTo(tipX, ry);
      ctx.strokeStyle = violet;
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.globalAlpha = lit ? 0.98 : 0.52;
      ctx.beginPath();
      ctx.moveTo(exitPt[0], exitPt[1]);
      ctx.lineTo(kX, kY);
      ctx.lineTo(tipX, ry);
      ctx.strokeStyle = violet;
      ctx.lineWidth = lit ? 3.1 : 1.8;
      ctx.stroke();
      label(ctx, showPcs.join(' '), tipX + 18, ry, { size: 20, weight: 700, color: violet });
      label(ctx, '离调', tipX + 74, ry, { size: 16, weight: 600, color: violet });
      ctx.restore();
    }
  }
}

// Physically accurate fretboard (strings 1-3 bend DOWN +y toward center; strings 4-6 bend UP -y).
function drawFretboard(ctx, time, guitar, active, chord, tonic, mode) {
  const lastFret = guitar.lastFret;
  const nut = left + 45, end = right - 14;
  const worldLeft = fretX(0);
  const dist = (end - nut) / (fretX(lastFret) - worldLeft);
  const wireX = (fret) => nut + (fretX(fret) - worldLeft) * dist;
  const center = (fret) => (fret === 0 ? wireX(0) - 22 : nut + (noteX(fret) - worldLeft) * dist);
  const fretPos = (fret) => lerp(center(Math.floor(fret)), center(Math.ceil(fret)), fret % 1);
  const top = 342, bottom = 548;
  const y = (string) => lerp(top, bottom, (string - 1) / 5);

  for (let fret = 0; fret <= lastFret; fret++) {
    line(ctx, wireX(fret), top, wireX(fret), bottom, fret === 0 ? '#8fa1aa' : wire, fret === 0 ? 3 : 1.2);
  }
  for (let string = 1; string <= 6; string++) {
    line(ctx, Math.max(left + 31, wireX(0)), y(string), end, y(string), '#5b6c7a', 1 + (string - 1) * 0.24);
    label(ctx, fullName(tuning[string - 1]).slice(0, -1), left - 9, y(string), { size: 16, weight: 600, align: 'right', color: muted });
  }
  for (const fret of [3, 5, 7, 9, 12, 15, 17, 19, 21].filter((f) => f <= lastFret)) {
    label(ctx, String(fret), center(fret), bottom + 26, { size: 17, weight: 600, align: 'center', color: muted });
  }

  const tones = new Map(chord?.tones.map((t) => [t.pc, t]) ?? []);
  const sounding = new Set(active.map((n) => `${n.string}:${n.fret}`));
  for (let string = 1; string <= 6; string++) {
    for (let fret = 0; fret <= lastFret; fret++) {
      if (sounding.has(`${string}:${fret}`)) continue;
      const pitch = tuning[string - 1] + fret;
      const p = pc(pitch);
      const tone = tones.get(p);
      const accent = modalAccent(p, tonic, mode);
      if (accent && tone) {
        dot(ctx, center(fret), y(string), 6.2, bg, accent, 1.8);
      } else if (tone) {
        dot(ctx, center(fret), y(string), 4.6, '#1e304c', '#7fa1e4', 1.3);
      }
    }
  }

  const released = notesAt(guitar.notes, time - 0.14).filter((n) => n.end <= time && !sounding.has(`${n.string}:${n.fret}`));
  for (const note of released) {
    ctx.globalAlpha = 0.42 * clamp(1 - (time - note.end) / 0.14);
    const col = modalAccent(note.pitch, tonic, mode) ?? blue;
    dot(ctx, center(note.fret), y(note.string), 13.5, null, col, 2);
  }
  ctx.globalAlpha = 1;

  for (const note of active) {
    const gesture = guitarGesture(note, time);
    const baseY = y(note.string);
    const x = fretPos(gesture.fret);
    const dir = note.string <= 3 ? 1 : -1;
    const dy = clamp(gesture.bend + gesture.oscillation, -2.5, 2.5) * 14 * dir;
    const playY = baseY + dy;
    const roundedPitch = note.pitch + Math.round(gesture.fret - note.fret + gesture.bend);
    const accent = modalAccent(roundedPitch, tonic, mode) ?? blue;

    if (note.techniques?.slide && Math.abs(x - center(note.fret)) > 2) {
      line(ctx, center(note.fret), baseY, x, baseY, accent, 3.2);
      dot(ctx, center(note.fret), baseY, 5, accent);
    }
    if (Math.abs(dy) > 1.5) {
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      ctx.quadraticCurveTo(x + 12, (baseY + playY) / 2, x, playY);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2.8;
      ctx.stroke();
    }
    const attack = 1 - clamp(gesture.age / 0.18);
    const r = 16 + attack * 3;
    ctx.globalAlpha = 0.22 + 0.12 * attack;
    dot(ctx, x, playY, r + 6 + attack * 8, accent);
    ctx.globalAlpha = 1;
    dot(ctx, x, playY, r, accent);
    const textCol = accent === blue ? '#ffffff' : '#0b0f16';
    label(ctx, toneName(roundedPitch, tonic, chord), x, playY, { size: 15, weight: 700, align: 'center', color: textCol, maxWidth: 2 * r - 3 });
    if (accent !== blue) {
      dot(ctx, x, playY, r + 4.5, null, accent, 1.7);
      label(ctx, scaleDegrees[pc(roundedPitch - tonic)], x + 26, playY - 11, { size: 17, weight: 700, color: accent });
    }
  }
}

function drawKeyStream(ctx, timeSec, keys, hasGuitar, song, tonic, mode) {
  const { low, high, spans } = keys;
  const top = hasGuitar ? 635 : 356, bottom = 910;
  const step = (bottom - top) / (high - low + 1);
  const y = (pitch) => top + (high - pitch + 0.5) * step;
  const keyLeft = hitX - 88;
  const sixPc = pc(tonic + 9);
  label(ctx, song === 'gig' ? '钢琴 · 风琴 · 人声' : '键盘 / 旋律', left, top - 28, { size: 21, weight: 600, color: muted });

  const active = new Map();
  for (let pitch = low; pitch <= high; pitch++) {
    const p = pc(pitch);
    if (p === 0) line(ctx, hitX, y(pitch), right, y(pitch), rail, 1.2);
    else if (p === sixPc && mode === 'dorian') {
      ctx.save();
      ctx.globalAlpha = 0.18;
      line(ctx, hitX, y(pitch), right, y(pitch), gold, 1.1);
      ctx.restore();
    }
  }
  for (const n of spans) {
    if (n.end <= timeSec) continue;
    const head = timeX(n.start, timeSec), tail = timeX(n.end, timeSec);
    if (head >= right) continue;
    const sounding = n.start <= timeSec;
    if (sounding) active.set(n.pitch, n);
    const melody = n.role === 'melody', yy = y(n.pitch);
    ctx.globalAlpha = sounding ? 1 : melody || n.accent ? 0.78 : 0.58;
    line(ctx, Math.max(hitX, head), yy, Math.min(right, tail), yy, n.color, melody ? 4.8 : 3.0);
    if (!sounding && n.attack) dot(ctx, head, yy, melody ? 4.3 : 3.0, n.color);
  }
  ctx.globalAlpha = 1;

  // White keys meet midway between adjacent naturals. Short black keys face the roll
  // so every strike dot lands on its exact semitone row, including E/F and B/C.
  for (let pitch = low; pitch <= high; pitch++) {
    if (blackKeys.has(pc(pitch))) continue;
    const upper = blackKeys.has(pc(pitch + 1)) ? 2 : 1;
    const lower = blackKeys.has(pc(pitch - 1)) ? 2 : 1;
    const y1 = Math.max(top, y(pitch + upper / 2));
    const y2 = Math.min(bottom, y(pitch - lower / 2));
    const n = active.get(pitch);
    ctx.fillStyle = n?.color ?? keyWhite;
    ctx.fillRect(keyLeft, y1, hitX - keyLeft, y2 - y1);
    ctx.strokeStyle = keyWhiteStroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(keyLeft, y1, hitX - keyLeft, y2 - y1);
    if (pc(pitch) === 0 && !n) label(ctx, fullName(pitch), keyLeft + 6, y(pitch), { size: Math.min(15, step * 1.25), weight: 600, color: muted });
  }
  for (let pitch = low; pitch <= high; pitch++) {
    if (!blackKeys.has(pc(pitch))) continue;
    const lit = active.get(pitch);
    ctx.fillStyle = lit?.color ?? keyBlack;
    ctx.fillRect(hitX - 53, y(pitch) - step * 0.39, 53, step * 0.78);
    if (!lit) {
      ctx.strokeStyle = keyBlackStroke;
      ctx.lineWidth = 0.8;
      ctx.strokeRect(hitX - 53, y(pitch) - step * 0.39, 53, step * 0.78);
    }
  }
  line(ctx, hitX, top, hitX, bottom, '#8ca0aa', 1.3);

  // Pitch-ordered anti-collision labels to keep dense chords readable on mobile screens
  const labels = [...active.values()].sort((a, b) => b.pitch - a.pitch);
  const gap = Math.min(27, Math.max(21, (bottom - top - 14) / Math.max(1, labels.length)));
  const rows = [];
  for (const n of labels) rows.push(Math.max(y(n.pitch), (rows.at(-1) ?? top - gap) + gap));
  let limit = bottom - 7;
  for (let i = rows.length - 1; i >= 0; i--) {
    rows[i] = Math.min(rows[i], limit);
    limit = rows[i] - gap;
  }
  labels.forEach((n, i) => {
    const yy = y(n.pitch);
    line(ctx, keyLeft - 36, rows[i], keyLeft - 9, yy, n.color, 1.7);
    label(ctx, n.name, keyLeft - 43, rows[i], { size: 23, weight: 700, align: 'right', color: n.color });
    if (n.accent) dot(ctx, hitX, yy, 9.5, bg, n.color, 1.8);
    dot(ctx, hitX, yy, n.role === 'melody' ? 6.0 : 4.4, n.color);
  });
}

function drawBottomTimeline(ctx, model, s, timeSec, activeChord) {
  const width = right - left;
  const x = (sec) => left + clamp(sec / (model.durationMs / 1000)) * width;
  const y = 1027;
  line(ctx, left, y, right, y, wire, 1.4);
  const cursor = x(timeSec);
  line(ctx, left, y, cursor, y, '#6d90c8', 2.0);
  dot(ctx, cursor, y, 4.8, '#9db8ff');
  label(ctx, clockStr(timeSec), left, 1000, { size: 19, color: muted });
  label(ctx, clockStr(model.durationMs / 1000), right, 1000, { size: 19, color: muted, align: 'right' });

  const local = (sec) => timeX(sec, timeSec);
  const row = 952;
  line(ctx, left, row, right, row, rail, 1.8);
  line(ctx, hitX, row - 8, hitX, row + 8, frost, 1.6);
  for (const ch of s.harmony ?? []) {
    const cs = ch.startMs / 1000, ce = ch.endMs / 1000;
    if (local(ce) <= left || local(cs) >= right) continue;
    const x1 = Math.max(left, local(cs)), x2 = Math.min(right, local(ce));
    const isAct = ch === activeChord;
    const col = isAct ? (ch.mode === 'chromatic' ? violet : frost) : '#4d6070';
    line(ctx, x1, row, Math.max(x1, x2 - 2), row, col, isAct ? 4.5 : 2.5);
    if (x2 - x1 >= 44) {
      label(ctx, display(ch.symbol), (x1 + x2) / 2, row + 23, { size: 17, weight: isAct ? 700 : 500, color: isAct ? col : muted, align: 'center', maxWidth: x2 - x1 - 4 });
    }
  }
}

export function createStudyRenderer(studyEvents = []) {
  const sceneCache = new WeakMap();
  return (s, t, h, ctx) => {
    if (!sceneCache.has(s)) sceneCache.set(s, buildSceneCache(s, studyEvents));
    drawStudy(s, t, h, ctx, sceneCache.get(s));
  };
}

function drawStudy(s, t, h, { g, model }, { l, guitar, keys, chords, tonic }) {
  const timeSec = t / 1000;
  const parsedChord = chords.get(h?.symbol);
  const mode = h?.mode ?? 'dorian';

  const activeGuitar = guitar.notes.length ? notesAt(guitar.notes, timeSec) : [];
  const soundingPcs = new Set();
  for (const n of keys.spans) {
    if (n.start <= timeSec && timeSec < n.end) soundingPcs.add(pc(n.pitch));
  }
  for (const note of activeGuitar) {
    const gesture = guitarGesture(note, timeSec);
    soundingPcs.add(pc(note.pitch + Math.round(gesture.fret - note.fret + gesture.bend)));
  }

  g.fillStyle = bg;
  g.fillRect(0, 0, 1920, 1080);

  drawPrismHeader(g, s, l, tonic, parsedChord, h, soundingPcs);
  drawBeatClock(g, t - s.startMs + (s.audio?.sourceInMs ?? 0), l);

  // Subtle horizon line separating prism telemetry from subtitle & instrument deck
  line(g, left, 250, right, 250, rail, 1.1);

  const cue = s.cues?.find((c) => c.startMs <= t && t < c.endMs);
  if (cue) {
    const fade = clamp((t - cue.startMs) / 240);
    g.globalAlpha = fade;
    label(g, cue.line1, 960, 286, { size: 26, weight: 600, color: milk, align: 'center', maxWidth: 1660 });
    g.globalAlpha = 1;
  }

  const hasGuitar = guitar.notes.length > 0;
  if (hasGuitar) drawFretboard(g, timeSec, guitar, activeGuitar, parsedChord, tonic, mode);
  drawKeyStream(g, timeSec, keys, hasGuitar, l.song, tonic, mode);

  drawBottomTimeline(g, model, s, timeSec, h);
}
