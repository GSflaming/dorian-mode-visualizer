// Original chord voicings and isolated teaching notes. No song events are sampled.
const keys = [
  { tonic: 'E', chords: ['Em7', 'A7', 'Cmaj7'], voicings: [[52, 55, 59, 62], [45, 55, 61, 64], [48, 55, 59, 64]], guitar: [62, 61, 60] },
  { tonic: 'D', chords: ['Dm7', 'G7', 'Bbmaj7'], voicings: [[50, 53, 57, 60], [43, 53, 59, 62], [46, 53, 57, 62]], guitar: [60, 59, 58] },
  { tonic: 'G', chords: ['Gm7', 'C9'], voicings: [[43, 65, 67, 70, 74], [48, 64, 67, 70, 74]] },
];

export function studyDemo() {
  const events = [];
  const barMs = 1600;
  let clock = 0;
  const scenes = keys.map(({ tonic, chords, voicings, guitar }) => {
    const id = 'demo-' + tonic.toLowerCase();
    const startMs = clock;
    const harmony = chords.map((symbol, i) => {
      const at = clock;
      clock += barMs;
      const sourceAt = at - startMs;
      for (const midi of voicings[i]) {
        events.push({ excerptId: id, part: 'piano', midi, startMs: sourceAt, endMs: sourceAt + barMs - 80 });
      }
      if (guitar) {
        const midi = guitar[i];
        events.push({
          excerptId: id, part: 'guitar', midi, startMs: sourceAt + 400, endMs: sourceAt + 1240,
          string: 3, fret: midi - 55,
        });
      }
      return { startMs: at, endMs: clock, symbol, mode: i === 2 ? 'chromatic' : 'dorian' };
    });
    return {
      id, excerptId: id, tonic, startMs, endMs: clock, title: tonic + ' Dorian · Synthetic study',
      view: 'case_study', audioMode: 'compare_audio',
      audio: { file: id + '.wav', sourceInMs: 0, title: 'Original synthetic tones' },
      bars: harmony.map(({ startMs, endMs }) => ({ startMs, endMs })),
      harmony,
      cues: [{
        startMs, endMs: clock,
        line1: { E: 'Listen for C♯ in A7, then C♮ in Cmaj7.', D: 'Listen for B♮ in G7, then B♭ in B♭maj7.', G: 'Follow F down to E♮ as Gm7 moves to C9.' }[tonic],
      }],
    };
  });
  return {
    model: { schemaVersion: 2, title: 'Dorian mode · Synthetic studies', fps: 30, durationMs: clock, scenes },
    events,
  };
}

export function synthStudy(events, durationMs) {
  const rate = 48000;
  const pcm = new Float32Array(durationMs * 48 * 2);
  for (const { part, midi, startMs, endMs } of events) {
    const start = startMs * 48;
    const count = (endMs - startMs) * 48;
    const omega = 2 * Math.PI * 440 * 2 ** ((midi - 69) / 12) / rate;
    const pluck = part === 'guitar';
    for (let i = 0; i < count; i++) {
      const ramp = Math.min(1, i / 192, (count - i) / 960);
      const decay = Math.exp(-i / (rate * (pluck ? 0.42 : 1.6)));
      const sample = (Math.sin(omega * i) + 0.18 * Math.sin(2 * omega * i)) * ramp * decay * (pluck ? 0.19 : 0.12);
      const frame = 2 * (start + i);
      pcm[frame] += sample * (pluck ? 0.68 : 1);
      pcm[frame + 1] += sample;
    }
  }
  return pcm;
}
