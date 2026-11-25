import { el, get } from './ui.mjs';
export async function align(model, revision, extra) {
  const audio = el('audio'),
    track = el('track'),
    scene = el('scene'),
    source = el('source'),
    events = el('events'),
    status = el('status');
  const canvas = el('wave'),
    g = canvas.getContext('2d'),
    files = await (await get('/api/tracks?' + extra)).json();
  track.add(new Option('选择录音', ''));
  files.forEach((file) => track.add(new Option(file, file)));
  el('align').hidden = el('marks').hidden = false;
  let s, data, version = 0, worker;
  const pos = () => Math.round(audio.currentTime * 1000);
  function duration() {
    return Math.round(audio.duration * 1000) || 1;
  }
  function display() {
    events.value = JSON.stringify({ harmony: s.harmony, bars: s.bars ?? [], cues: s.cues }, null, 2);
  }
  function commit(checkLength = true) {
    const edit = JSON.parse(events.value);
    for (const key of ['harmony', 'bars', 'cues']) {
      if (!Array.isArray(edit[key])) throw Error('缺少 ' + key);
    }
    Object.assign(s, { harmony: edit.harmony, bars: edit.bars, cues: edit.cues });
    if (track.value) {
      if (!source.value || !Number.isSafeInteger(+source.value) || +source.value < 0) {
        throw Error('切入点须为非负整数');
      }
      s.audio = {
        ...s.audio,
        title: s.audio?.title ?? track.value,
        file: track.value,
        sourceInMs: +source.value,
      };
      if (
        checkLength && Number.isFinite(audio.duration) && +source.value + s.endMs - s.startMs > duration()
      ) throw Error('所选切片超出录音长度');
    }
  }
  function paint() {
    const w = canvas.width, h = canvas.height;
    g.fillStyle = '#faf8f0';
    g.fillRect(0, 0, w, h);
    const x = (ms) => ms / duration() * w;
    g.fillStyle = '#d4e0e7';
    g.fillRect(x(+source.value), 0, x(s.endMs - s.startMs), h);
    if (data) {
      g.fillStyle = '#596b61';
      for (let i = 0; i < w; i++) {
        const a = Math.floor(i * data.waveform.length / w),
          b = Math.max(a + 1, Math.floor((i + 1) * data.waveform.length / w));
        let peak = 0;
        for (let k = a; k < b; k++) peak = Math.max(peak, data.waveform[k] ?? 0);
        g.fillRect(i, h / 2 - peak * h / 2, 1, Math.max(1, peak * h));
      }
      g.fillStyle = '#c86c38';
      for (const ms of data.candidates) g.fillRect(x(ms), 0, 2, 25);
    }
    g.fillStyle = '#244e8c';
    for (const e of [...s.harmony, ...(s.bars ?? []), ...s.cues]) {
      g.fillRect(x(+source.value + e.startMs - s.startMs), 133, 2, 37);
    }
    g.fillStyle = '#ab3224';
    g.fillRect(x(pos()), 0, 3, h);
  }
  async function load() {
    worker?.terminate();
    const seq = ++version;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    data = null;
    paint();
    if (!track.value) {
      status.textContent = s.audio ? '缺少素材 ' + s.audio.file : '软电钢琴 · 可选择实录';
      return;
    }
    const url = '/api/track?file=' + encodeURIComponent(track.value) + extra;
    audio.src = url;
    status.textContent = '正在分析整轨波形与色度变化';
    const raw = await (await get(url)).arrayBuffer(), ctx = new OfflineAudioContext(2, 1, 12000);
    const decoded = await ctx.decodeAudioData(raw);
    if (seq !== version) return;
    const left = decoded.getChannelData(0).slice(),
      right = decoded.getChannelData(Math.min(1, decoded.numberOfChannels - 1)).slice();
    worker = new Worker('/v2/worker.mjs', { type: 'module' });
    worker.onmessage = (e) => {
      if (seq !== version) return;
      data = e.data;
      status.textContent = data.candidates.length + ' 个候选变化';
      paint();
      worker.terminate();
    };
    worker.onerror = (e) => status.textContent = e.message;
    worker.postMessage({ left, right, rate: decoded.sampleRate }, [left.buffer, right.buffer]);
  }
  async function select() {
    s = model.scenes.find((item) => item.id === scene.value);
    display();
    source.value = s.audio?.sourceInMs ?? 0;
    track.value = files.includes(s.audio?.file) ? s.audio.file : '';
    await load();
  }
  const safe = (fn) => async () => {
    try {
      await fn();
    } catch (e) {
      status.textContent = e.message;
    }
  };
  scene.onchange = safe(async () => {
    const id = scene.value;
    try {
      commit();
    } catch (e) {
      scene.value = s.id;
      throw e;
    }
    scene.value = id;
    await select();
  });
  track.onchange = safe(load);
  el('rate').onchange = () => audio.playbackRate = Number(el('rate').value);
  audio.onloadedmetadata = () => {
    audio.currentTime = Math.min(audio.duration, +source.value / 1000);
    audio.playbackRate = +el('rate').value;
    paint();
  };
  audio.ontimeupdate = audio.onseeked = paint;
  source.oninput = paint;
  el('markIn').onclick = () => {
    source.value = pos();
    paint();
  };
  el('markOut').onclick = safe(() => {
    commit(false);
    const length = pos() - Number(source.value);
    if (length <= 0) throw Error('切出点须晚于切入点');
    const end = s.startMs + length, delta = end - s.endMs;
    for (const list of [s.harmony, s.cues, s.bars ?? []]) {
      if (list.some((e) => e.endMs > end)) throw Error('请先将标注调整到新片尾以内');
    }
    for (const later of model.scenes.slice(model.scenes.indexOf(s) + 1)) {
      for (const item of [later, ...later.harmony, ...later.cues, ...(later.bars ?? [])]) {
        item.startMs += delta;
        item.endMs += delta;
        if (item.beatsMs) item.beatsMs = item.beatsMs.map((b) => b + delta);
      }
    }
    s.endMs = end;
    model.durationMs += delta;
    display();
    paint();
    status.textContent = '切片长度 ' + length + ' ms';
  });
  function seek(e) {
    if (audio.readyState) {
      audio.currentTime = Math.max(
        0,
        Math.min(
          audio.duration,
          (e.clientX - canvas.getBoundingClientRect().left) / canvas.clientWidth * audio.duration,
        ),
      );
    }
  }
  canvas.onpointerdown = (e) => {
    canvas.setPointerCapture(e.pointerId);
    seek(e);
  };
  canvas.onpointermove = (e) => {
    if (canvas.hasPointerCapture(e.pointerId)) seek(e);
  };
  function mark(key) {
    commit();
    const ms = s.startMs + pos() - Number(source.value);
    if (ms < s.startMs || ms > s.endMs || ms === s.endMs && key !== 'cueEnd') {
      throw Error('请在蓝色切片范围内打点');
    }
    if (key === 'beat') {
      const bars = s.bars ??= [], bar = bars.find((b) => b.startMs <= ms && ms < b.endMs);
      if (!bar) {
        bars.push({
          startMs: ms,
          endMs: bars.find((b) => b.startMs > ms)?.startMs ?? s.endMs,
          beatsMs: [ms],
        });
        s.bars = bars.sort((a, b) => a.startMs - b.startMs);
      } else bar.beatsMs = [...new Set([...(bar.beatsMs ?? []), ms])].sort((a, b) => a - b);
    } else if (key === 'cueEnd') {
      const cue = s.cues.findLast((c) => c.startMs < ms);
      if (!cue) throw Error('请先设置字幕起点');
      cue.endMs = ms;
    } else {
      const list = s[key] ??= [],
        prev = list.findLast((e) => e.startMs < ms),
        next = list.find((e) => e.startMs > ms);
      const item = { startMs: ms, endMs: next?.startMs ?? s.endMs };
      if (key === 'harmony') {
        Object.assign(item, { symbol: el('symbol').value, mode: el('mode').value || null });
      }
      if (key === 'cues') {
        const line1 = prompt('第一行字幕');
        if (!line1) return;
        Object.assign(item, { line1 });
        const line2 = prompt('第二行字幕（可空）');
        if (line2) Object.assign(item, { line2, line2DelayMs: Number(prompt('第二行延迟 ms', '0')) });
      }
      if (prev && prev.endMs > ms) {
        prev.endMs = ms;
        if (prev.beatsMs) {
          item.beatsMs = prev.beatsMs.filter((b) => b >= ms);
          prev.beatsMs = prev.beatsMs.filter((b) => b < ms);
        }
      }
      s[key] = [...list.filter((e) => e.startMs !== ms), item].sort((a, b) => a.startMs - b.startMs);
    }
    display();
    paint();
  }
  for (const key of ['harmony', 'bars', 'beat', 'cues', 'cueEnd']) el(key).onclick = safe(() => mark(key));
  onkeydown = (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
    const id = { h: 'harmony', m: 'bars', b: 'beat', q: 'cues', e: 'cueEnd' }[e.key];
    if (id) {
      e.preventDefault();
      el(id).click();
    }
  };
  el('save').onclick = safe(async () => {
    commit();
    const res = await fetch('/api/save?' + extra, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, hash: revision }),
    });
    const msg = await res.text();
    if (!res.ok) throw Error(msg);
    revision = msg;
    status.textContent = '配置已保存';
  });
  el('export').onclick = safe(async () => {
    commit();
    const { validate } = await import('./model.mjs');
    validate(model, await (await get('/config/v2.schema.json')).json());
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' }));
    a.download = s.id + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  await select();
}
