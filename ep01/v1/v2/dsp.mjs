// Two real channels packed into one complex FFT. Averaging their spectral
// powers preserves out-of-phase stereo components.
function spectrumPlan(n) {
  const rev = new Uint32Array(n), cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  const win = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n));
  for (let i = 1; i < n; i++) rev[i] = (rev[i >> 1] >> 1) | ((i & 1) * n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos(-2 * Math.PI * i / n);
    sin[i] = Math.sin(-2 * Math.PI * i / n);
  }
  const re = new Float64Array(n), im = new Float64Array(n), power = new Float64Array(n / 2);
  return (left, right, center) => {
    for (let i = 0; i < n; i++) {
      const j = center + i - n / 2;
      re[rev[i]] = (left[j] ?? 0) * win[i];
      im[rev[i]] = (right[j] ?? 0) * win[i];
    }
    for (let stride = 2; stride <= n; stride *= 2) {
      const half = stride / 2;
      for (let base = 0; base < n; base += stride) {
        for (let j = 0; j < half; j++) {
          const a = base + j, b = a + half, k = j * n / stride;
          const x = re[b] * cos[k] - im[b] * sin[k], y = re[b] * sin[k] + im[b] * cos[k];
          re[b] = re[a] - x;
          im[b] = im[a] - y;
          re[a] += x;
          im[a] += y;
        }
      }
    }
    for (let k = 1; k < n / 2; k++) {
      power[k] = (re[k] ** 2 + im[k] ** 2 + re[n - k] ** 2 + im[n - k] ** 2) / (n * n);
    }
    return power;
  };
}
const round = (x) => Math.round(x * 10000) / 10000;
export function analyze(left, right, rate, fps) {
  const n = 2 ** Math.round(Math.log2(rate * 0.25)), fft = spectrumPlan(n);
  const frames = [], waveform = [], candidates = [];
  const hop = Math.max(1, Math.round(rate / 200));
  for (let i = 0; i < left.length; i += hop) {
    let peak = 0;
    for (let j = i; j < Math.min(i + hop, left.length); j++) {
      peak = Math.max(peak, Math.abs(left[j]), Math.abs(right[j]));
    }
    waveform.push(round(peak));
  }
  for (let i = 0; i < Math.ceil(left.length * fps / rate); i++) {
    const start = Math.round(i * rate / fps), end = Math.min(left.length, Math.round((i + 1) * rate / fps));
    let energy = 0;
    for (let j = start; j < end; j++) energy += (left[j] ** 2 + right[j] ** 2) / 2;
    const rms = round(Math.sqrt(energy / Math.max(1, end - start)));
    const power = fft(left, right, start), bands = [0, 0, 0], chroma = Array(12).fill(0);
    for (let k = 1; k < power.length - 1; k++) {
      const freq = k * rate / n, p = power[k];
      bands[freq < 250 ? 0 : freq < 2000 ? 1 : 2] += p;
      if (freq < 45 || freq > 4800 || p < 1e-10 || p <= power[k - 1] || p < power[k + 1]) continue;
      const a = Math.log(power[k - 1] + 1e-30), b = Math.log(p), c = Math.log(power[k + 1] + 1e-30);
      const hz = (k + 0.5 * (a - c) / (a - 2 * b + c)) * rate / n;
      const pitch = 69 + 12 * Math.log2(hz / 440), note = Math.round(pitch);
      chroma[note % 12] += p * (1 - Math.abs(pitch - note));
    }
    const max = Math.max(1e-9, ...chroma);
    const frame = {
      rms,
      bands: bands.map((e) => round(Math.sqrt(e / 0.375))),
      chroma: chroma.map((e) => round(Math.sqrt(e / max))),
    };
    const prev = frames.at(-1);
    if (
      prev && (rms - prev.rms > 0.025 || chroma.some((_, k) => frame.chroma[k] - prev.chroma[k] > 0.22)) &&
      i * 1000 / fps - (candidates.at(-1) ?? -1000) > 120
    ) candidates.push(Math.round(i * 1000 / fps));
    frames.push(frame);
  }
  return { fps, sampleRate: rate, waveformHop: hop, waveform, frames, candidates };
}
