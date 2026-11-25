// Downloadable Sounds (RIFF DLS) PCM regions from an installed system sound bank.
// Only the region metadata and PCM needed for these General MIDI programs are read.
function chunks(buffer, start, end) {
  const result = [];
  for (let at = start; at + 8 <= end;) {
    const id = buffer.toString('ascii', at, at + 4);
    const length = buffer.readUInt32LE(at + 4);
    const next = at + 8 + length;
    if (next > end) throw new Error('Invalid DLS chunk length');
    result.push({ id, start: at + 8, end: next });
    at = next + (length & 1);
  }
  return result;
}

export function openBank(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'DLS ') {
    throw new Error('Expected a RIFF DLS sound bank');
  }
  const root = chunks(buffer, 12, buffer.length);
  const list = (items, type) => items.find(item =>
    item.id === 'LIST' && buffer.toString('ascii', item.start, item.start + 4) === type);
  const children = item => chunks(buffer, item.start + 4, item.end);
  const at = (items, id) => items.find(item => item.id === id)?.start;
  const u16 = offset => buffer.readUInt16LE(offset);
  const u32 = offset => buffer.readUInt32LE(offset);
  const pool = list(root, 'wvpl');
  const table = at(root, 'ptbl');
  const programs = new Map();
  for (const item of children(list(root, 'lins'))) {
    const fields = children(item);
    const header = at(fields, 'insh');
    const bank = u32(header + 4);
    const program = u32(header + 8);
    if (!(bank === 0 && [27,29,33].includes(program) || bank === 0x80000000 && program === 0)) continue;
    programs.set(`${bank}:${program}`, children(list(fields, 'lrgn')).map(region => {
      const data = children(region);
      const range = at(data, 'rgnh');
      return { low: u16(range), high: u16(range + 2), wsmp: at(data, 'wsmp'), wave: u32(at(data, 'wlnk') + 8) };
    }));
  }
  const cache = new Map();
  return (program, midi, drums = false) => {
    const key = `${drums}:${program}:${midi}`;
    if (cache.has(key)) return cache.get(key);
    const region = programs.get(`${drums ? 0x80000000 : 0}:${program}`)?.find(item => item.low <= midi && midi <= item.high);
    if (!region) throw new Error(`DLS program ${program} has no region for MIDI ${midi}`);
    const start = pool.start + 4 + u32(table + u32(table) + region.wave * 4);
    const wave = chunks(buffer, start + 12, start + 8 + u32(start + 4));
    const pcm = wave.find(item => item.id === 'data');
    const fmt = at(wave, 'fmt ');
    const bits = u16(fmt + 14);
    const channels = u16(fmt + 2);
    if (u16(fmt) !== 1 || ![8,16].includes(bits) || !channels) throw new Error('Unsupported DLS PCM format');
    const stride = (bits / 8) * channels;
    const data = new Float32Array(Math.floor((pcm.end - pcm.start) / stride));
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const offset = pcm.start + i * stride;
      const value = bits === 8 ? (buffer[offset] - 128) / 128 : buffer.readInt16LE(offset) / 32768;
      data[i] = value;
      peak = Math.max(peak, Math.abs(value));
    }
    const wsmp = region.wsmp ?? at(wave, 'wsmp');
    const loopData = wsmp === undefined ? 0 : wsmp + u32(wsmp);
    const hasLoop = !drums && wsmp !== undefined && u32(wsmp + 16) > 0;
    const loopStart = hasLoop ? u32(loopData + 8) : 0;
    const loopEnd = hasLoop ? loopStart + u32(loopData + 12) : 0;
    const result = { data, peak: Math.max(.05, peak), rate: u32(fmt + 4),
      root: wsmp === undefined ? midi : u16(wsmp + 4) - buffer.readInt16LE(wsmp + 6) / 100,
      loopStart, loopEnd: loopEnd <= data.length ? loopEnd : 0 };
    cache.set(key, result);
    return result;
  };
}
