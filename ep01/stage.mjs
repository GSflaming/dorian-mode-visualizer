import { drawBoard } from './vendor/tokyo/draw.mjs';
import { display } from './vendor/tokyo/theory.mjs';
import { BOARD_RANGE, HEIGHT, WIDTH, clamp, frameState, modes } from './timeline.mjs';

const ink = '#18181B';
const muted = '#62626D';
const pale = '#DFE2EA';
const blue = '#1D4ED8';
const purple = '#7C3AED';
const red = '#C24118';
const tint = '#F6F7FA';
const font = '"PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", system-ui, sans-serif';
const ease = (value) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};
const colorOf = (note, fallback = blue) => note === 'C♮' ? purple : note === 'C♯' ? red : fallback;

export function makeStage(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const board = document.createElement('canvas');
  board.width = 1380;
  board.height = 257;

  function type(value, x, y, size, { color = ink, weight = 600, align = 'left' } = {}) {
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = align;
    ctx.fillText(value, x, y);
  }

  function line(x1, y1, x2, y2, color = pale, width = 2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  function box(x, y, w, h, fill, stroke = null) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 20);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  }

  function arrow(x1, y1, x2, y2, color = muted) {
    line(x1, y1, x2, y2, color, 2.5);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    for (const side of [-1, 1]) {
      const dir = angle + side * 0.52;
      line(x2, y2, x2 - 14 * Math.cos(dir), y2 - 14 * Math.sin(dir), color, 2.5);
    }
  }

  function pulse(ctx, point, amount, color, radius = 15) {
    ctx.beginPath();
    ctx.globalAlpha = .65 * (1 - amount);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.arc(point.x, point.y, radius + 13 * amount, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function comparison(state) {
    const other = state.scene.bars.find(bar => bar.chord?.symbol !== 'Em7');
    const feature = other.chord.symbol === 'A7' ? 'C♯' : 'C♮';
    const activeSecond = state.bar.chord.symbol === other.chord.symbol;
    for (const [index, bar] of [state.scene.bars[0], other].entries()) {
      const x = index ? 1010 : 105;
      const active = Boolean(index) === activeSecond;
      const accent = index ? colorOf(feature) : blue;
      box(x, 281, 805, 226, active ? tint : '#FFFFFF', active ? accent : pale);
      const chord = bar.chord;
      type(chord.symbol, x + 42, 356, 72, { color: active ? accent : ink });
      type(bar.roman, x + 762, 354, 30, { color: muted, align: 'right' });
      chord.tones.forEach((tone, i) => {
        const name = tone.name === 'C' ? 'C♮' : display(tone.name);
        const emphasis = index && i === 1;
        type(name, x + 48 + i * 104, 448, 37, { color: emphasis ? accent : muted });
      });
      if (index && active) {
        const motion = state.animations.find(event => event.type === 'feature');
        if (motion) {
          const amount = clamp((state.local - motion.at) / motion.duration);
          pulse(ctx, { x: x + 169, y: 447 }, amount, accent, 24);
        }
      }
    }
    arrow(934, 393, 984, 393);
  }

  function voices(state) {
    const changed = state.bar.chord?.symbol === 'A7';
    const event = state.scene.animations.find(item => item.type === 'shift');
    const mix = ease((state.local - event.at) / event.duration);
    type('Am7', 220, 326, 60, { color: changed ? muted : purple });
    type('A7', 1700, 326, 60, { color: changed ? red : muted, align: 'right' });
    const cells = [['A', 'A'], ['C♮', 'C♯'], ['E', 'E'], ['G', 'G']];
    cells.forEach(([lower, higher], index) => {
      const y = 321 + 52 * index;
      if (lower === higher) {
        line(697, y, 1223, y, pale);
        type(lower, 635, y, 36, { color: muted, align: 'center' });
        type(higher, 1285, y, 36, { color: muted, align: 'center' });
      } else {
        line(697, y, 1223, y - 22, '#DACBE8');
        arrow(804, y - 5, 1112, y - 17, purple);
        type(lower, 635, y, 37, { color: purple, align: 'center' });
        type(higher, 1285, y - 22, 37, { color: red, align: 'center' });
        type('+1 半音', 960, y - 39, 24, { color: muted, align: 'center' });
        if (mix > 0 && mix < 1) {
          ctx.beginPath();
          ctx.arc(697 + 526 * mix, y - 22 * mix, 9, 0, Math.PI * 2);
          ctx.fillStyle = red;
          ctx.fill();
        }
      }
    });
  }

  function scales(state) {
    const activeEvent = state.animations.find(item => item.type === 'degree');
    for (const [row, mode] of Object.values(modes).entries()) {
      const y = 338 + row * 109;
      const active = state.bar.mode === mode;
      const accent = row ? red : purple;
      if (active) box(105, y - 48, 1710, 95, tint);
      type(mode.name, 145, y, 36, { color: active ? ink : muted });
      mode.notes.forEach((name, i) => {
        const x = 550 + i * 142;
        type(name, x, y - 9, 40, { color: i === 5 ? accent : i === 0 ? blue : ink, align: 'center' });
        type(mode.degrees[i], x, y + 27, 20, { color: muted, align: 'center', weight: 500 });
      });
      type(row ? 'B → C♯  全音' : 'C♮ → B  半音', 1775, y, 28, { color: accent, align: 'right' });
      if (active && activeEvent) {
        pulse(ctx, { x: 1260, y: y - 10 }, clamp((state.local - activeEvent.at) / activeEvent.duration), accent, 30);
      }
    }
  }

  function tritone(state) {
    if (state.bar.chord.symbol === 'Em7') {
      type('A7', 105, 405, 85, { color: red });
      arrow(305, 404, 389, 404, muted);
      type('Em7', 427, 405, 85, { color: blue });
      type('E   G   B   D', 1815, 408, 47, { align: 'right', color: muted });
      return;
    }
    type('C♯4', 110, 385, 93, { color: red });
    type('A7 的三音', 113, 467, 29, { color: muted });
    type('G4', 1810, 385, 93, { align: 'right', color: blue });
    type('A7 的七音', 1807, 467, 29, { color: muted, align: 'right' });
    const start = 569;
    const span = 782;
    const event = state.scene.animations.find(item => item.type === 'tritone');
    const reveal = event ? ease((state.local - event.at) / event.duration) : 1;
    line(start, 397, start + span, 397);
    if (reveal > 0) arrow(start, 397, start + span * reveal, 397, red);
    for (let i = 0; i <= 6; i++) {
      const x = start + span * i / 6;
      line(x, 390, x, 407);
    }
    type('减五度  ·  三全音', 960, 460, 36, { align: 'center' });
  }

  function instrument(state, intervals) {
    const showTritone = state.cue.view === 'tritone' && state.bar.chord.symbol === 'A7';
    const showShift = state.cue.view === 'voices' && state.local >= 4;
    const pins = showTritone ? [{ string: 2, fret: 2 }, { string: 1, fret: 3 }] :
      showShift ? [{ string: 2, fret: 1 }, { string: 2, fret: 2 }] : [];
    const feature = state.animations.find(item => item.type === 'feature');
    const positions = state.positions.map(position => {
      const pin = pins.findIndex(item => item.string === position.string && item.fret === position.fret);
      return { ...position, pin };
    });
    if (showShift && !positions.some(position => position.pin === 0)) {
      positions.push({ string: 2, fret: 1, name: 'C♮', tone: { interval: '♭6' }, pin: 0 });
    }

    drawBoard(board, { positions, layer: 'theory' }, BOARD_RANGE, intervals, { mix: 1 }, false, {
      marker(position) {
        const accent = colorOf(position.name);
        if (position.known) return { fill: ink, stroke: accent, scale: 1.13 };
        if (position.candidate) return { fill: '#FFF', stroke: ink, ink, scale: 1.08 };
        if (position.pin === 0 && showShift) return { fill: '#FFF', stroke: purple, ink: purple };
        if (position.chord || position.pin >= 0) return { fill: accent };
        return { fill: '#E5E9F0', ink: '#3F4C65', scale: .86 };
      },
      behindMarkers(boardCtx, point) {
        if (feature) {
          const second = { string: 2, fret: state.bar.mode === modes.dorian ? 2 : 1 };
          pulse(boardCtx, point(second), clamp((state.local - feature.at) / feature.duration), state.bar.mode === modes.dorian ? red : purple);
        }
        if (!pins.length) return;
        const a = point(pins[0]);
        const b = point(pins[1]);
        const event = state.animations.find(item => item.type === (showTritone ? 'tritone' : 'shift'));
        const mix = event ? ease((state.local - event.at) / event.duration) : 1;
        boardCtx.save();
        boardCtx.strokeStyle = red;
        boardCtx.lineWidth = 2.4;
        if (showShift) boardCtx.setLineDash([4, 5]);
        boardCtx.beginPath();
        boardCtx.moveTo(a.x, a.y);
        boardCtx.lineTo(a.x + (b.x - a.x) * mix, a.y + (b.y - a.y) * mix);
        boardCtx.stroke();
        boardCtx.restore();
      }
    });
    ctx.drawImage(board, 105, 553, 1710, 318);
    const legend = [[blue, '和弦内音'], ['#E5E9F0', '音阶内音'], [ink, '实录弦品'], ['#FFFFFF', '实录音高候选']];
    for (const [i, [color, label]] of legend.entries()) {
      const x = 105 + i * 232;
      ctx.beginPath();
      ctx.arc(x + 9, 904, 8, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      if (i === 3) {
        ctx.strokeStyle = ink;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      type(label, x + 27, 904, 22, { color: muted, weight: 500 });
    }
    type('标准调弦 · 0–7 品', 1815, 904, 22, { align: 'right', color: muted, weight: 500 });
  }

  function footer(state) {
    const x0 = 105;
    const gap = 18;
    const width = (1710 - gap * (state.scene.bars.length - 1)) / state.scene.bars.length;
    for (const [index, bar] of state.scene.bars.entries()) {
      const x = x0 + index * (width + gap);
      line(x, 963, x + width, 963, pale, 3);
      if (index <= state.barIndex) {
        const progress = clamp(state.beat / state.scene.beatsPerBar - index);
        if (progress) line(x, 963, x + width * progress, 963, blue, 4);
      }
      const currentBeat = Math.floor(state.beat);
      for (let beat = 0; beat < state.scene.beatsPerBar; beat++) {
        const active = index * state.scene.beatsPerBar + beat === currentBeat;
        ctx.fillStyle = active ? blue : pale;
        ctx.fillRect(x + beat * width / state.scene.beatsPerBar, 970, active ? 7 : 3, 6);
      }
      type(String(index + 1).padStart(2, '0') + '   ' + (bar.chord?.symbol ?? bar.mode.name), x, 994, 20,
        { color: index === state.barIndex ? blue : muted, weight: 550 });
    }
    type('Pink Floyd〈Breathe〉· 原创教学示范', 105, 1043, 21, { color: muted, weight: 500 });
    type(state.audioStatus + state.noteStatus, 1815, 1043, 21, { color: muted, align: 'right', weight: 500 });
  }

  return function render(model, seconds, assets = {}, intervals = false) {
    const state = frameState(model, seconds, assets);
    ctx.fillStyle = '#FFF';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    type(model.title, 105, 53, 27);
    type(state.scene.title, 1815, 53, 24, { align: 'right', color: muted });
    line(105, 92, 1815, 92);
    type(state.bar.mode.name + (state.bar.chord ? '   /   ' + state.bar.chord.symbol + '  ' + state.bar.roman : ''),
      105, 122, 24, { color: blue });
    for (const [index, [delay, caption]] of state.cue.lines.entries()) {
      const visible = ease((state.local - state.cue.at - delay) / .35);
      ctx.globalAlpha = visible;
      type(caption, 105, 174 + index * 57 + (1 - visible) * 12, index ? 36 : 49, { color: index ? muted : ink });
      ctx.globalAlpha = 1;
    }
    if (state.scene.kind === 'compare') comparison(state);
    if (state.cue.view === 'voices') voices(state);
    if (state.cue.view === 'scales') scales(state);
    if (state.cue.view === 'tritone') tritone(state);
    instrument(state, intervals);
    footer(state);
    if (state.scene.transition.type === 'fade' && state.local < state.scene.transition.duration) {
      ctx.globalAlpha = 1 - ease(state.local / state.scene.transition.duration);
      ctx.fillStyle = '#FFF';
      ctx.fillRect(0, 153, WIDTH, 771);
      ctx.globalAlpha = 1;
    }
    return state;
  };
}
