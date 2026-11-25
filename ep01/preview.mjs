import { makeStage } from './stage.mjs';
import { clamp, compile, RATE, trackClip } from './timeline.mjs';

const $ = id => document.getElementById(id);
const readJson = async path => {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} 读取失败`);
  return response.json();
};

async function start() {
  const [project, initialNotes] = await Promise.all([readJson('./config/scenes.json'), readJson('./config/notes.json')]);
  let notes = initialNotes;
  let model = compile(project, notes);
  const render = makeStage($('stage'));
  const assets = {};
  const context = new AudioContext({ sampleRate: RATE });
  let time = 0;
  let anchor = null;
  let playbackAttempt = 0;
  let animation = 0;
  let sources = [];

  function paint() {
    const state = render(model, time, assets, $('intervals').checked);
    $('scene').value = state.scene.id;
    $('seek').value = Math.min(model.frames - 1, Math.floor(time * model.fps + 1e-7));
    $('time').value = `${time.toFixed(3)} / ${model.duration.toFixed(0)} s`;
  }

  const current = () => anchor ? clamp(anchor.time + Math.max(0, context.currentTime - anchor.clock), model.duration) : time;
  function stop() {
    playbackAttempt++;
    time = current();
    anchor = null;
    cancelAnimationFrame(animation);
    sources.forEach(source => source.stop());
    sources = [];
    $('play').textContent = '播放';
    paint();
  }

  function seek(next) {
    const wasPlaying = anchor !== null;
    stop();
    time = clamp(next, (model.frames - 1) / model.fps);
    paint();
    if (wasPlaying) void play();
  }

  function tick() {
    time = current();
    if (time >= model.duration) return stop();
    paint();
    animation = requestAnimationFrame(tick);
  }

  async function play() {
    const attempt = ++playbackAttempt;
    try {
      await context.resume();
      if (attempt !== playbackAttempt) return;
      if (time >= model.duration) time = 0;
      anchor = { time, clock: context.currentTime + .045 };
      for (const scene of model.scenes) {
        const sceneStart = scene.startFrame / model.fps;
        for (const track of scene.tracks) {
          const source = assets[track.key];
          if (!source) continue;
          const clip = trackClip(track, scene, source.duration);
          const start = Math.max(time, sceneStart + clip.start);
          const length = sceneStart + clip.end - start;
          if (length <= 0) continue;
          const node = context.createBufferSource();
          const gain = context.createGain();
          node.buffer = source;
          gain.gain.value = track.gain;
          node.connect(gain).connect(context.destination);
          node.onended = () => { node.disconnect(); gain.disconnect(); };
          node.start(anchor.clock + start - time, clip.offset + start - sceneStart - clip.start, length);
          sources.push(node);
        }
      }
      $('play').textContent = '暂停';
      animation = requestAnimationFrame(tick);
    } catch (error) {
      stop();
      $('message').textContent = error.message;
    }
  }

  async function decode(bytes) {
    const signature = new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength));
    if (String.fromCharCode(...signature.subarray(0, 4)) !== 'RIFF' ||
      String.fromCharCode(...signature.subarray(8)) !== 'WAVE') throw new Error('请选择 RIFF WAV 文件');
    const buffer = await context.decodeAudioData(bytes);
    if (![1, 2].includes(buffer.numberOfChannels)) throw new Error('请导出单声道或立体声 WAV');
    return buffer;
  }

  function revise() {
    model = compile(project, notes);
    paint();
  }

  function trackRow(scene, track) {
    const assetKey = `${scene.id}/${track.id}`;
    const row = document.createElement('div');
    row.className = 'track';
    const name = document.createElement('strong');
    name.textContent = `${scene.id} · ${track.id}`;
    const filename = document.createElement('span');
    filename.textContent = track.file;
    const status = document.createElement('output');
    status.className = 'track-status';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.wav,audio/wav';
    input.setAttribute('aria-label', `${scene.id} ${track.id} WAV`);
    row.append(name, filename, status, input);
    function refreshStatus() {
      const source = assets[assetKey];
      if (!source) { status.value = '缺失'; return; }
      const compiledScene = model.scenes.find(item => item.id === scene.id);
      const compiledTrack = compiledScene.tracks.find(item => item.id === track.id);
      const clip = trackClip(compiledTrack, compiledScene, source.duration);
      status.value = clip.end <= clip.start ? '无可用区间' :
        clip.end + .025 < (compiledTrack.until ?? compiledScene.duration) ? '时长不足' : '已载入';
    }

    for (const [field, caption] of [['at', '片段放入秒'], ['sourceIn', '前置裁剪秒'], ['noteOffset', '打点修正秒']]) {
      const label = document.createElement('label');
      label.textContent = caption + ' ';
      const number = document.createElement('input');
      number.type = 'number';
      number.step = '.001';
      number.value = track[field] ?? 0;
      if (field === 'sourceIn') number.min = 0;
      number.addEventListener('change', () => {
        if (!Number.isFinite(number.valueAsNumber)) {
          number.value = track[field] ?? 0;
          return;
        }
        stop();
        const previous = track[field];
        track[field] = number.valueAsNumber;
        try {
          revise();
          refreshStatus();
          $('message').textContent = '已更新预览校准。导出时可用下载的场景配置。';
        } catch (error) {
          track[field] = previous;
          number.value = previous ?? 0;
          $('message').textContent = error.message;
        }
      });
      label.append(number);
      row.append(label);
    }

    let generation = 0;
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      const attempt = ++generation;
      try {
        if (!/^[\w-]+\.wav$/i.test(file.name)) throw new Error('WAV 文件名请使用英文字母、数字、下划线或连字符');
        const buffer = await decode(await file.arrayBuffer());
        if (attempt !== generation) return;
        stop();
        assets[assetKey] = buffer;
        track.file = file.name;
        filename.textContent = track.file;
        revise();
        refreshStatus();
        $('message').textContent = '已从本机载入 WAV。渲染时请把文件放进音频目录。';
      } catch (error) {
        if (attempt === generation) $('message').textContent = error.message;
      }
    });
    $('tracks').append(row);
    return async () => {
      status.value = '载入中';
      try {
        const response = await fetch('./assets/audio/' + encodeURIComponent(track.file));
        if (response.status === 404) return;
        if (!response.ok) throw new Error(`WAV 读取失败 ${response.status}`);
        const buffer = await decode(await response.arrayBuffer());
        if (!generation) assets[assetKey] = buffer;
      } catch (error) {
        $('message').textContent = `${scene.id} ${track.file} · ${error.message}`;
      } finally { refreshStatus(); }
    };
  }

  const loaders = project.scenes.flatMap(scene => scene.audio.map(track => trackRow(scene, track)));
  $('seek').max = model.frames - 1;
  for (const scene of model.scenes) $('scene').add(new Option(`${scene.id} · ${scene.title}`, scene.id));
  $('play').addEventListener('click', () => anchor ? stop() : void play());
  $('seek').addEventListener('input', () => seek(Number($('seek').value) / model.fps));
  $('scene').addEventListener('change', () => seek(model.scenes.find(scene => scene.id === $('scene').value).startFrame / model.fps));
  for (const [id, direction] of [['back', -1], ['forward', 1]]) {
    $(id).addEventListener('click', () => {
      stop();
      seek((Math.round(time * model.fps) + direction) / model.fps);
    });
  }
  $('intervals').addEventListener('change', paint);
  $('notes').addEventListener('change', async () => {
    const file = $('notes').files[0];
    if (!file) return;
    try {
      const next = JSON.parse(await file.text());
      const compiled = compile(project, next);
      notes = next;
      model = compiled;
      paint();
      $('message').textContent = '实录打点已载入预览';
    } catch (error) { $('message').textContent = error.message; }
  });
  $('download').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(project, null, 2) + '\n'], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: 'ep01-calibrated.json' });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  await document.fonts.ready;
  paint();
  await Promise.all(loaders.map(load => load()));
  if ($('message').textContent === '正在载入场景和 WAV') {
    $('message').textContent = Object.keys(assets).length ? '实录 WAV 已载入' : '等待创作者实录 WAV，可以先静音播放';
  }
  paint();
  $('play').disabled = false;
}
start().catch(error => { $('message').textContent = error.message; });
