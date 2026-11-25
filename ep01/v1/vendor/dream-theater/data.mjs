import { parseChord, parseNote, pc, positionVoices } from './theory.mjs';
import { EPS, makeTiming } from './timing.mjs';

export const statuses = ['Verified', 'Imported', 'Estimated', 'Unknown'];
export const statusName = { Verified: '人工确认', Imported: '已导入', Estimated: '候选', Unknown: '未知' };
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const check = (condition, message) => { if (!condition) throw new Error(message); };
const arrays = ['sections', 'keyRegions', 'chordEvents', 'bassEvents', 'voicings', 'voiceLeadingEvents', 'analysisNotes', 'provenance'];

export function normalizeSong(input) {
  check(input && input.schemaVersion === 1 && ['song', 'study'].includes(input.kind), '需要 SongAnalysis schemaVersion 1');
  const song = structuredClone(input);
  const meta = song.songMetadata;
  const audio = song.audioMetadata;
  check(typeof meta?.title === 'string' && meta.title.trim() && audio &&
    finite(audio.durationSeconds) && audio.durationSeconds > 0 && finite(audio.beatZeroSeconds) && typeof audio.calibrated === 'boolean', '缺少歌曲或音频时间信息');
  check(statuses.includes(song.verificationStatus), '缺少项目校对状态');
  for (const field of arrays) check(Array.isArray(song[field]), `缺少数组 ${field}`);
  for (const field of ['tempoMap', 'timeSignatureMap']) {
    check(Array.isArray(song[field]) && song[field][0]?.beat === 0, `${field} 必须从第 0 拍开始`);
    for (const [i, node] of song[field].entries()) {
      check(finite(node.beat) && (!i || node.beat > song[field][i - 1].beat), `${field} 必须按拍位递增`);
    }
  }
  for (const node of song.tempoMap) check(finite(node.bpm) && node.bpm >= 10 && node.bpm <= 500, 'BPM 范围为 10–500');
  for (const [i, node] of song.timeSignatureMap.entries()) {
    check(Number.isInteger(node.numerator) && node.numerator > 0 && node.numerator <= 32 &&
      [1, 2, 4, 8, 16, 32].includes(node.denominator), '拍号无效');
    if (i) {
      const last = song.timeSignatureMap[i - 1];
      const bars = (node.beat - last.beat) / (last.numerator * 4 / last.denominator);
      check(Math.abs(bars - Math.round(bars)) < EPS, '拍号变化必须落在小节边界');
    }
  }
  const timing = makeTiming(song.tempoMap, song.timeSignatureMap, audio.beatZeroSeconds);
  const sources = new Set();
  for (const source of song.provenance) {
    check(typeof source.id === 'string' && source.id.trim() && !sources.has(source.id) &&
      typeof source.label === 'string' && source.label.trim(), '来源缺少唯一 ID 或名称');
    if (source.url) check(/^https?:\/\//i.test(source.url), '来源链接只接受 HTTP 或 HTTPS');
    sources.add(source.id);
  }
  const checkEvidence = (entry) => {
    check(statuses.includes(entry.status) && sources.has(entry.sourceId), '记录缺少有效来源或校对状态');
    if (entry.status === 'Verified') check(typeof entry.review?.note === 'string' && entry.review.note.trim() &&
      typeof entry.review?.at === 'string' && Number.isFinite(Date.parse(entry.review.at)), '人工确认需要校对备注和时间');
  };
  for (const field of ['sections', 'keyRegions', 'chordEvents', 'bassEvents']) {
    const entries = song[field];
    for (const entry of entries) {
      check(finite(entry.startBeat) && finite(entry.endBeat) && entry.endBeat - entry.startBeat > EPS,
        `${field} 的结束拍位须大于起始拍位`);
      checkEvidence(entry);
    }
    entries.sort((a, b) => a.startBeat - b.startBeat || a.endBeat - b.endBeat);
    if (field === 'sections' || field === 'chordEvents') {
      entries.forEach((entry, i) => {
        check(!i || entry.startBeat >= entries[i - 1].endBeat - EPS, `${field} 存在重叠区间`);
      });
    }
  }
  const chords = new Map();
  for (const event of song.chordEvents) {
    check(typeof event.id === 'string' && event.id.trim() && !chords.has(event.id), '和弦事件必须有唯一 ID');
    check(typeof event.symbol === 'string' && event.symbol.trim() && event.symbol.length < 60, '和弦记号无效');
    chords.set(event.id, parseChord(event.symbol));
  }
  for (const section of song.sections) check(typeof section.name === 'string' && section.name.trim(), '分段需要名称');
  for (const region of song.keyRegions) {
    check(parseNote(region.tonic).midi === null && typeof region.interpretation === 'string' && region.interpretation.trim() &&
      typeof region.evidence === 'string' && region.evidence.trim() &&
      finite(region.confidence) && region.confidence >= 0 && region.confidence <= 1,
    '调性解释需要主音、解释、依据与 0–1 置信程度');
  }
  const tracks = new Map();
  for (const event of song.bassEvents) {
    check(typeof event.track === 'string' && event.track.trim(), '低音事件需要轨道名');
    validateVoice(event);
    const end = tracks.get(event.track);
    check(end === undefined || event.startBeat >= end - EPS, `低音轨道重叠 ${event.track}`);
    tracks.set(event.track, event.endBeat);
  }
  const voicingKeys = new Set();
  for (const voicing of song.voicings) {
    checkEvidence(voicing);
    check(chords.has(voicing.chordId) && ['selected', 'recording'].includes(voicing.layer),
      '指型或声部必须关联一个有效和弦与来源层');
    const id = JSON.stringify([voicing.chordId, voicing.layer]);
    check(!voicingKeys.has(id), '每个和弦在同一个来源层只能有一个配置');
    voicingKeys.add(id);
    if (voicing.layer === 'recording') check(voicing.status === 'Verified', '录音声部需要人工核对');
    const { positions, voices } = voicing;
    check(Boolean(positions?.length || voices?.length) && (!positions || Array.isArray(positions)) &&
      (!voices || Array.isArray(voices) && voices.length <= 32) &&
      (voicing.layer !== 'selected' || positions?.length), '指型或声部数据无效');
    if (positions) positionVoices(positions, chords.get(voicing.chordId));
    if (voices) voices.forEach(validateVoice);
  }
  for (const event of song.voiceLeadingEvents) {
    check(chords.has(event.fromId) && chords.has(event.toId) &&
      ['minimum', 'fixed', 'guitar'].includes(event.mode), '声部连接注释需要两个和弦 ID 和有效策略');
    checkEvidence(event);
  }
  for (const note of song.analysisNotes) {
    check(typeof note.text === 'string' && note.text.trim(), '分析注释缺少正文');
    checkEvidence(note);
    if (note.startBeat != null || note.endBeat != null) {
      check(finite(note.startBeat) && finite(note.endBeat) && note.endBeat > note.startBeat, '分析注释拍位无效');
    }
  }
  return { song, timing };
}

function validateVoice(voice) {
  check(Number.isInteger(voice.midi) && voice.midi >= 0 && voice.midi <= 127, '需要 MIDI 0–127 的整数音高');
  if (voice.name) {
    const note = parseNote(voice.name);
    check(note.midi === voice.midi || (note.midi === null && note.pc === pc(voice.midi)), '音名拼写与 MIDI 音高不符');
  }
}

// Preserve the evidence, while marking records that need a new time alignment.
export function invalidateAlignment(song) {
  song.verificationStatus = 'Unknown';
  for (const field of ['sections', 'keyRegions', 'chordEvents', 'bassEvents', 'voiceLeadingEvents', 'analysisNotes']) {
    for (const entry of song[field]) {
      if (entry.status === 'Verified' && (entry.startBeat != null || field === 'voiceLeadingEvents')) {
        entry.status = 'Imported';
      }
    }
  }
  for (const voicing of song.voicings) {
    if (voicing.layer === 'recording') voicing.reviewRequired = true;
  }
}

export function importChordCsv(text, original, sourceLabel) {
  // Quoted fields may contain commas, escaped quotes, and line breaks.
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n') + '\n';
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if ((char === ',' || char === '\n') && !quoted) {
      row.push(field);
      field = '';
      if (char === '\n') {
        if (row.some(value => value.trim())) rows.push(row);
        row = [];
      }
    } else field += char;
  }
  check(!quoted, 'CSV 引号未闭合');
  const header = rows.shift() ?? [];
  const indexes = ['startBeat', 'endBeat', 'symbol'].map(name => header.findIndex(field => field.trim() === name));
  check(indexes.every(index => index >= 0) && rows.length, 'CSV 表头需要 startBeat,endBeat,symbol，且至少有一行');
  const song = structuredClone(original);
  const sourceId = `csv-${globalThis.crypto.randomUUID()}`;
  song.provenance.push({ id: sourceId, label: sourceLabel, kind: 'local-csv' });
  const noteIndex = header.findIndex(field => field.trim() === 'note');
  for (const [index, values] of rows.entries()) {
    const [start, end, symbol] = indexes.map(column => values[column]?.trim());
    check(start && end && symbol, `CSV 第 ${index + 2} 行有空列`);
    song.chordEvents.push({ id: `${sourceId}-${index}`, startBeat: Number(start), endBeat: Number(end), symbol,
      sourceId, status: 'Imported', note: values[noteIndex]?.trim() ?? '' });
  }
  return normalizeSong(song).song;
}

export const serializeSong = (song) => JSON.stringify(normalizeSong(song).song, null, 2) + '\n';
