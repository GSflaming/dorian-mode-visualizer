import { parseChord } from '../vendor/dream-theater/theory.mjs';
export const active = (items, t) => items?.find((x) => x.startMs <= t && t < x.endMs);
export function validate(model, schema) {
  function check(v, s, path) {
    const fail = () => {
      throw Error('配置字段无效 ' + path);
    };
    if (s.const !== undefined && v !== s.const || s.enum && !s.enum.includes(v)) fail();
    if (s.type === 'integer' && (!Number.isSafeInteger(v) || v < s.minimum)) fail();
    if (
      s.type === 'string' &&
      (typeof v !== 'string' || !v.trim() || s.pattern && !new RegExp(s.pattern).test(v))
    ) fail();
    if (s.type === 'array') {
      if (!Array.isArray(v) || v.length < s.minItems || v.length > s.maxItems) fail();
      v.forEach((x, i) => check(x, s.items, path + '[' + i + ']'));
    }
    if (s.type === 'object') {
      if (!v || typeof v !== 'object' || Array.isArray(v) || s.required.some((k) => !Object.hasOwn(v, k))) {
        fail();
      }
      for (const [k, x] of Object.entries(v)) {
        if (!Object.hasOwn(s.properties, k)) fail();
        check(x, s.properties[k], path + '.' + k);
      }
    }
  }
  check(model, schema, 'v2');
  let end = 0;
  const ids = new Set();
  for (const s of model.scenes) {
    function require(ok, msg) {
      if (!ok) throw Error(s.id + ' · ' + msg);
    }
    require(!ids.has(s.id) && s.startMs === end && s.endMs > end, '场景须连续且 ID 唯一');
    ids.add(s.id);
    end = s.endMs;
    require(s.audioMode !== 'external_audio' || s.audio, '缺少录音文件');
    for (const events of [s.harmony, s.cues, s.bars ?? []]) {
      let last = s.startMs;
      for (const e of events) {
        require(last <= e.startMs && e.startMs < e.endMs && e.endMs <= end, '事件越界或重叠');
        last = e.endMs;
        if (e.symbol) parseChord(e.symbol);
        require((e.line2DelayMs ?? 0) < e.endMs - e.startMs, '第二行延迟超出字幕区间');
        e.beatsMs?.forEach((b, i, a) =>
          require(b >= e.startMs && b < e.endMs && (!i || b > a[i - 1]), '拍点越界或重复')
        );
      }
    }
    require(s.audio || s.harmony.length, '软电钢琴需要和弦');
    if (s.view === 'compare_ab') {
      const [a, b] = s.harmony;
      require(
        s.harmony.length === 2 && a.startMs === s.startMs && a.endMs === b.startMs &&
          b.endMs === end && a.endMs - a.startMs === end - b.startMs,
        'A/B 需要两个连续等长的和弦',
      );
      const left = parseChord(a.symbol).tones.map((t) => t.pc),
        right = parseChord(b.symbol).tones.map((t) => t.pc);
      require(
        left.includes(0) && !left.includes(1) && right.includes(1) && !right.includes(0) &&
          left.map((k) => k === 0 ? 1 : k).sort().join() === right.sort().join(),
        'A/B 的和弦内音仅可变动 C♮ → C♯',
      );
    }
  }
  if (end !== model.durationMs) throw Error('节目时长不符');
  return model;
}
export function sourceLabel(s) {
  if (s.view === 'case_study') {
    if (s.audioMode === 'external_audio') {
      return ['原曲录音分析', s.audio?.artist, s.audio?.title, s.audio?.edition].filter(Boolean).join('  /  ');
    }
    return '原创教学示范  /  与原曲分析区分';
  }
  if (s.audioMode === 'compare_audio') return s.audio ? '听觉对照 · 实录' : '听觉对照 · 软电钢琴';
  return [s.audio.artist === '测试夹具' ? '合成测试录音' : '原曲录音分析', s.audio.artist, s.audio.title]
    .filter(Boolean).join('  /  ');
}
