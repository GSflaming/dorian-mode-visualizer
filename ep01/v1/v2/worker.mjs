import { analyze } from './dsp.mjs';
onmessage = ({ data: { left, right, rate } }) => {
  const { waveform, candidates, waveformHop } = analyze(left, right, rate, 30);
  postMessage({ waveform, candidates, waveformHop, rate });
};
