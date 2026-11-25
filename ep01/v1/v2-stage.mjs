import { createStudyRenderer } from './part2/draw.mjs';
import { active, sourceLabel } from './v2/model.mjs';
import { display, parseChord, theoreticalVoices } from './vendor/dream-theater/theory.mjs';
import { VoiceLeadingEngine } from './vendor/dream-theater/voice-leading.mjs';
export const WIDTH = 1920, HEIGHT = 1080;
const names = ['C♮', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const views = {
  case_study: '作品细读',
  track_analysis: '原曲切片',
  theory_anatomy: '乐理剖面',
  compare_ab: '听觉对照',
  album_map: '专辑结构',
};
const albums = [['E', 'Breathe / Reprise', 'Em7 ↔ A7'], ['G', 'The Great Gig in the Sky', 'Gm7 ↔ C7'], [
  'D',
  'Any Colour You Like',
  'Dm7 ↔ G7',
], ['finale', 'Brain Damage / Eclipse', 'D major']];
const clamp = (x) => Math.max(0, Math.min(1, x));
export function createV2Stage(model, features, canvas) {
  const drawStudy = createStudyRenderer(features.studyEvents);
  const g = canvas.getContext('2d'), chords = new Map();
  for (const s of model.scenes) for (const h of s.harmony) chords.set(h.symbol, parseChord(h.symbol));
  const sections = new Map();
  for (const s of model.scenes) {
    const spans = [];
    for (const h of s.harmony) {
      const prior = spans.at(-1);
      if (prior && prior.mode === h.mode && prior.endMs === h.startMs && !h.label) prior.endMs = h.endMs;
      else spans.push({ startMs: h.startMs, endMs: h.endMs, mode: h.mode, label: h.label });
    }
    sections.set(s, spans);
  }
  const motions = new Map();
  for (const s of model.scenes) {
    s.harmony.slice(1).forEach((h, i) => {
      const prior = s.harmony[i].symbol;
      const m = VoiceLeadingEngine.analyze(
        theoreticalVoices(chords.get(prior)),
        theoreticalVoices(chords.get(h.symbol)),
      );
      const held = m.common.map((v) => display(v.from.tone.name)).join(' / ');
      const step = m.moves.filter((v) => Math.abs(v.semitones) === 1).map((v) =>
        display(v.from.tone.name) + ' → ' + display(v.to.tone.name)
      ).join('   ');
      motions.set(h, [held && held + ' 保持', step].filter(Boolean).join('     '));
    });
  }
  return function drawAtMs(playheadMs, options = {}) {
    const t = Math.max(0, Math.min(model.durationMs - 0.001, playheadMs)),
      s = active(model.scenes, t),
      h = active(s.harmony, t),
      cue = active(s.cues, t);
    const f = features.frames[Math.min(features.frames.length - 1, Math.floor(t * features.fps / 1000))];
    const dark = options.theme === 'dark',
      bg = dark ? '#202320' : '#f5f1e7',
      ink = dark ? '#faf5e8' : '#252a26',
      muted = dark ? '#b3b8aa' : '#596359',
      rule = dark ? '#51584e' : '#d5d3c6';
    const blue = dark ? '#82b3ff' : '#2455a0',
      red = dark ? '#ff9771' : '#b74024',
      violet = dark ? '#c3a8f3' : '#784e91';
    const center=({E:4,D:2,G:7})[s.tonic??'E'];
    const color=k=>k===center?blue:k===(center+9)%12?red:k===(center+8)%12?violet:muted;
    function rect(x, y, w, height, c) {
      if (w > 0 && height > 0) {
        g.fillStyle = c;
        g.fillRect(x, y, w, height);
      }
    }
    function txt(str, x, y, size, max = 1750, c = ink, serif = false) {
      if (!str || max <= 0) return;
      const normal = `400 ${size}px ${
        serif ? 'Georgia, ' : ''
      }"Hiragino Sans GB", "Noto Sans CJK SC", sans-serif`;
      const symbol = `400 ${size}px "Apple Symbols", "DejaVu Sans", sans-serif`;
      const runs = String(str).split(/([♮♭♯↔→×]+)/u).filter(Boolean).map((text) => {
        const font = /^[♮♭♯↔→×]/u.test(text) ? symbol : normal;
        g.font = font;
        return { text, font, width: g.measureText(text).width };
      });
      const width = runs.reduce((sum, r) => sum + r.width, 0);
      const scale = Math.min(1, max / Math.max(1, width));
      options.onText?.({ x, y, width: width * scale, height: size, text: str });
      g.save();
      g.translate(x, y);
      g.scale(scale, 1);
      g.fillStyle = c;
      let cursor = 0;
      for (const run of runs) {
        g.font = run.font;
        g.fillText(run.text, cursor, 0);
        cursor += run.width;
      }
      g.restore();
    }
    function wave(y, height) {
      if (options.waveform === false) return;
      const x0 = 76, w = 1768, span = 4200;
      rect(x0, y + height / 2, w, 1, rule);
      for (let x = 0; x < w; x += 3) {
        const ms = t + (x / w - 0.5) * span;
        if (ms < s.startMs || ms >= s.endMs) continue;
        const p = features.waveform[Math.floor(ms * features.sampleRate / (1000 * features.waveformHop))] ??
          0;
        const b = features.frames[Math.floor(ms * features.fps / 1000)]?.bands ?? [0, 0, 0];
        const a = Math.max(1, Math.sqrt(p) * height * 0.48);
        rect(x0 + x, y + height / 2 - a, 2, 2 * a, b[2] > b[0] ? red : b[1] > b[0] ? blue : muted);
      }
      rect(959, y, 3, height, ink);
      g.beginPath();
      g.arc(960, y + height / 2, 3 + 10 * clamp(f.rms + f.bands[0]), 0, Math.PI * 2);
      g.fillStyle = red;
      g.fill();
    }
    function heat(x, y, w, height) {
      if (options.chroma === false) return;
      names.forEach((n, k) => {
        const dx = x + k * w / 12, bar = w / 12 - 8;
        rect(dx, y, bar, height, rule);
        const val = clamp(f.chroma[k]);
        rect(dx, y + height * (1 - val), bar, height * val, color(k));
        txt(n, dx, y + height + 32, 23, bar, color(k));
      });
    }
    if (s.view === 'case_study') {
      g.save();
      g.scale(canvas.width / WIDTH, canvas.height / HEIGHT);
      drawStudy(s, t, h, { model, features, g, txt, rect, blue, red, violet, rule, ink, bg, muted });
      g.restore();
      return { scene: s.id, chord: h?.symbol, cue: cue?.line1 };
    }
    g.save();
    g.scale(canvas.width / WIDTH, canvas.height / HEIGHT);
    rect(0, 0, WIDTH, HEIGHT, bg);
    txt('EP 01    /    ' + views[s.view], 76, 87, 26, 600, muted);
    txt(sourceLabel(s), 1010, 87, 25, 834, muted);
    rect(76, 111, 1768, 2, rule);
    txt(s.title, 76, 211, 72, 1768);
    if (s.view === 'track_analysis') {
      wave(256, 166);
      for (const bar of s.bars ?? []) {
        for (const ms of [bar.startMs, ...(bar.beatsMs ?? [])]) {
          const x = 960 + (ms - t) * 1768 / 4200;
          if (x >= 76 && x <= 1843) rect(x, 416, 1, 12, ink);
        }
      }
      for (const chord of s.harmony) {
        const x = Math.max(76, 960 + (chord.startMs - t) * 1768 / 4200),
          end = Math.min(1844, 960 + (chord.endMs - t) * 1768 / 4200);
        if (end <= x) continue;
        rect(x, 438, end - x - 1, 62, chord === h ? ink : rule);
        if (end - x > 40) txt(chord.symbol, x + 10, 480, 33, end - x - 20, chord === h ? bg : ink, true);
      }
      rect(959, 431, 3, 75, red);
      const position = (ms) => 76 + 1768 * (ms - s.startMs) / (s.endMs - s.startMs);
      rect(76, 522, 1768, 5, rule);
      for (const span of sections.get(s)) {
        const x = position(span.startMs), width = position(span.endMs) - x;
        rect(x, 522, Math.max(1, width - 3), 5, span.mode === 'chromatic' ? violet : muted);
        if (width > 90) txt(span.label ?? span.mode, x, 554, 21, width - 8, muted);
      }
      rect(position(t) - 2, 514, 4, 22, red);
      if (options.chroma !== false) {
        txt('音高类能量     '+names[center]+' · 1     '+names[(center+9)%12]+' · 6     '+names[(center+8)%12]+' · ♭6', 76, 603, 26, 850, muted);
        heat(76, 638, 910, 130);
      }
      if (options.reference !== false) {
        txt('和弦内音参考', 1050, 603, 26, 700, muted);
        const chord = chords.get(h?.symbol);
        txt(h?.symbol ?? '待打点', 1050, 681, 58, 340, ink, true);
        txt(h?.label ?? (center===4 && chord?.symbol === 'Cmaj7' ? '脱离 Dorian' : h?.mode), 1440, 674, 29, 398, violet);
        const whites = [0, 2, 4, 5, 7, 9, 11];
        function key(pc, x, w, height, black) {
          const tone = chord?.tones.find((v) => v.pc === pc);
          rect(x, 700, w, height, tone ? color(pc) : black ? ink : rule);
          if (tone) txt(display(tone.name), x + 6, 700 + height - 8, 23, w - 12, bg);
        }
        whites.forEach((pc, i) => key(pc, 1050 + i * 112, 109, 89, false));
        [1, 3, 6, 8, 10].forEach((pc) =>
          key(pc, 1050 + (whites.indexOf(pc - 1) + 1) * 112 - 31, 62, 47, true)
        );
        txt(motions.get(h), 1050, 819, 27, 780, muted);
      }
    } else if (s.view === 'compare_ab') {
      s.harmony.forEach((item, i) => {
        const x = 76 + i * 900, on = item === h, c = i ? red : violet;
        rect(x, 306, 866, 443, on ? ink : rule);
        const fg = on ? bg : ink;
        txt((i ? 'B' : 'A') + '     /     ' + item.symbol, x + 50, 386, 38, 740, fg);
        txt(i ? 'C♯' : 'C♮', x + 50, 615, 172, 650, on ? (i ? '#ffa383' : '#d2b7ee') : c, true);
        const common = chords.get(s.harmony[0].symbol).tones.filter((tone) => tone.pc !== 0);
        txt(common.map((tone) => display(tone.name)).join('     ·     '), x + 50, 696, 34, 720, fg);
      });
    } else if (s.view === 'album_map') {
      albums.forEach(([key, title, pair], i) => {
        const x = 76 + i * 448, on = key === s.albumKey;
        rect(x, 325, 420, 5, on ? red : rule);
        txt(key === 'finale' ? 'D major' : key + ' Dorian', x, 452, 60, 410, on ? red : ink, true);
        txt(title, x, 523, 27, 410);
        txt(pair, x, 586, 31, 400, muted);
      });
      wave(640, 72);
      heat(76, 745, 1768, 44);
    } else {
      const phase = clamp((t - s.startMs) / (s.endMs - s.startMs));
      if (s.anatomy === 'gravity' || s.anatomy === 'tritone') {
        const grav = s.anatomy === 'gravity', x = 330 + 1210 * phase, y = grav ? 405 + 190 * phase : 505;
        txt(grav ? '半音下行' : '相隔六个半音', 76, 328, 33, 750, muted);
        g.beginPath();
        g.moveTo(330, grav ? 405 : 505);
        g.lineTo(1540, grav ? 595 : 505);
        g.strokeStyle = rule;
        g.lineWidth = 7;
        g.stroke();
        g.beginPath();
        g.arc(x, y, 19, 0, 2 * Math.PI);
        g.fillStyle = red;
        g.fill();
        txt(grav ? 'C♮' : 'C♯', 120, 485, 104, 200, grav ? violet : red, true);
        txt(grav ? 'B' : 'G', 1590, grav ? 650 : 550, 104, 210, blue, true);
      } else if (s.anatomy === 'center') {
        txt('D 大调', 76, 384, 48, 840, muted);
        txt('ii7 → V7 → I  ×', 76, 548, 83, 820, muted, true);
        txt('E Dorian', 1000, 384, 48, 810, blue);
        txt('i7 ↔ IV7', 1000, 548, 90, 820, ink, true);
        txt('Em7 ↔ A7', 1000, 682, 50, 800, blue, true);
        rect(1000, 715, 760 * phase, 6, blue);
      } else {
        txt('Em9  +  A7', 76, 398, 90, 1400, ink, true);
        const arrival = s.harmony.find((ch) => ch.symbol === 'A7')?.startMs ??
          (s.startMs + 0.5 * (s.endMs - s.startMs));
        const pcs = [4, 6, 7, 9, 11, 1, 2], degrees = ['1', '2', '♭3', '4', '5', '6', '♭7'];
        pcs.forEach((pc, i) => {
          const x = 76 + i * 254,
            arrive = clamp((t - (pc === 9 || pc === 1 ? arrival : s.startMs) - i * 12) / 380);
          rect(x, 681, 223, 4, rule);
          g.globalAlpha = 0.18 + 0.82 * arrive;
          txt(names[pc], x, 625 - (1 - arrive) * 98, 86, 210, color(pc), true);
          g.globalAlpha = 1;
          txt(degrees[i], x, 746, 34, 210, muted);
        });
      }
    }
    rect(76, 860, 1768, 2, rule);
    if (cue && options.cues !== false) {
      const age = t - cue.startMs;
      g.globalAlpha = clamp(age / 220);
      txt(cue.line1, 76, 935, 43, 1450);
      txt(cue.badge, 1550, 932, 24, 284, muted);
      g.globalAlpha = clamp((age - (cue.line2DelayMs ?? 0)) / 220);
      txt(cue.line2, 76, 1009, 40, 1768, muted);
    }
    g.restore();
    return { scene: s.id, chord: h?.symbol, cue: cue?.line1 };
  };
}
