const modes = ['minimum', 'fixed', 'guitar'];

// Hungarian assignment, with an explicit birth/death slot for every voice.
function assignment(matrix) {
  const size = matrix.length;
  const u = Array(size + 1).fill(0);
  const v = Array(size + 1).fill(0);
  const columnRow = Array(size + 1).fill(0);
  const path = Array(size + 1).fill(0);
  for (let row = 1; row <= size; row++) {
    columnRow[0] = row;
    let column = 0;
    const distances = Array(size + 1).fill(Infinity);
    const used = Array(size + 1).fill(false);
    do {
      used[column] = true;
      const current = columnRow[column];
      let delta = Infinity;
      let next = 0;
      for (let j = 1; j <= size; j++) {
        if (used[j]) continue;
        const cost = matrix[current - 1][j - 1] - u[current] - v[j];
        if (cost < distances[j]) {
          distances[j] = cost;
          path[j] = column;
        }
        if (distances[j] < delta) {
          delta = distances[j];
          next = j;
        }
      }
      for (let j = 0; j <= size; j++) {
        if (used[j]) {
          u[columnRow[j]] += delta;
          v[j] -= delta;
        } else {
          distances[j] -= delta;
        }
      }
      column = next;
    } while (columnRow[column]);
    do {
      const previous = path[column];
      columnRow[column] = columnRow[previous];
      column = previous;
    } while (column);
  }
  return columnRow.slice(1).reduce((rows, row, column) => {
    rows[row - 1] = column;
    return rows;
  }, []);
}

export class VoiceLeadingEngine {
  static analyze(before, after, { mode = 'minimum', gapCost = 6, matchRule } = {}) {
    if (!modes.includes(mode) || !Number.isFinite(gapCost) || gapCost < 0 ||
        [...before, ...after].some(voice => !Number.isInteger(voice.midi) || voice.midi < 0 || voice.midi > 127)) {
      throw new Error('声部策略、增删成本或 MIDI 音高无效');
    }
    const size = before.length + after.length;
    const forbidden = (size + 1) * (2 * gapCost + 128);
    const known = mode !== 'minimum';
    const key = (voice) => mode === 'guitar' ? voice.string :
      voice.id == null ? null : JSON.stringify([voice.instrument ?? '', voice.id]);
    const keys = known && [before, after].map(voices => {
      const counts = new Map();
      for (const voice of voices) {
        const id = key(voice);
        if (id != null) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      return counts;
    });
    const matrix = Array.from({ length: size }, (_, i) =>
      Array.from({ length: size }, (_, j) => {
        if (i >= before.length && j >= after.length) return 0;
        if (i >= before.length || j >= after.length) return known ? forbidden / 3 : gapCost;
        const left = before[i];
        const right = after[j];
        if (matchRule && !matchRule(left, right)) return forbidden;
        const id = key(left);
        if (known && (id == null || id !== key(right) || keys.some(counts => counts.get(id) !== 1))) {
          return forbidden;
        }
        const distance = Math.abs(left.midi - right.midi);
        return known ? distance : distance - (distance === 0 ? 0.001 / (size + 1) : 0);
      }));
    const matched = new Set();
    const moves = assignment(matrix).slice(0, before.length).map((j, i) => {
      const from = before[i];
      if (j >= after.length || matrix[i][j] === forbidden) {
        return { from, to: null, left: i, right: null, kind: 'removed', semitones: null };
      }
      matched.add(j);
      const to = after[j];
      const semitones = to.midi - from.midi;
      const kind = semitones === 0 ? 'held' : semitones > 0 ? 'up' : 'down';
      return { from, to, left: i, right: j, kind, semitones };
    });
    after.forEach((to, j) => {
      if (!matched.has(j)) moves.push({ from: null, to, left: null, right: j, kind: 'added', semitones: null });
    });
    const motion = moves.filter(move => move.semitones !== null);
    const crossing = [];
    motion.forEach((a, index) => {
      for (const b of motion.slice(index + 1)) {
        if ((a.from.midi - b.from.midi) * (a.to.midi - b.to.midi) < 0) crossing.push([a.left, b.left]);
      }
    });
    return {
      moves, common: motion.filter(move => move.kind === 'held'), crossing,
      total: motion.reduce((sum, move) => sum + Math.abs(move.semitones), 0),
      max: Math.max(0, ...motion.map(move => Math.abs(move.semitones))),
      parallelSemitone: before.length > 1 && motion.length === before.length && motion.length === after.length &&
        [1, -1].some(step => motion.every(move => move.semitones === step)),
    };
  }
}
