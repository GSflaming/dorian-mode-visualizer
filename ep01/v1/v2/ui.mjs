import { createV2Stage } from '../v2-stage.mjs';
import { active, sourceLabel } from './model.mjs';
import { align } from './align.mjs';
export const el = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search),
  demo = params.get('demo') === '1',
  extra = demo ? '&demo=1' : '';
const part2 = ['part2', 'part2-original', 'part2-demo'].includes(params.get('mode')) ? params.get('mode') : null;
const editing = params.get('mode') === 'align', base = '/output/v2/' + (part2 ? part2+'/' : demo ? 'demo/' : '');
const status = el('status'), audio = el('audio'), scene = el('scene');
export async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw Error('无法加载 ' + url);
  return r;
}
export async function hash(data) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', data)),
    (x) => x.toString(16).padStart(2, '0'),
  ).join('');
}
async function start() {
  el('preview').href = '/?mode=v2' + extra;
  el('editor').href = '/?mode=align' + extra;
  const raw = await (await get(demo || part2 ? base + 'v2.json' : '/config/v2.json')).arrayBuffer();
  const model = JSON.parse(new TextDecoder().decode(raw)), configHash = await hash(raw);
  model.scenes.forEach((s) => scene.add(new Option(s.title + ' · ' + s.id, s.id)));
  if(part2){el('preview').href='/?mode='+part2;el('editor').hidden=true}
  el('title').textContent = editing ? '原曲打点' : model.title;
  if (editing) return align(model, configHash, extra);
  if (!part2) {
    const files = await (await get('/api/tracks?' + extra)).json();
    const missing = model.scenes.map((s) => s.audio?.file).filter((f) => f && !files.includes(f));
    if (missing.length) throw Error('缺少素材 ' + [...new Set(missing)].join('、'));
  }
  const manifest = await (await get(base + 'manifest.json')).json(),
    buf = await (await get(base + 'features.json')).arrayBuffer();
  if (configHash !== manifest.configHash || await hash(buf) !== manifest.featuresHash) {
    throw Error('配置或特征已变化');
  }
  const master = await (await get(base + 'master.wav')).arrayBuffer();
  if (await hash(master) !== manifest.masterHash) throw Error('母版指纹不符');
  const draw = createV2Stage(model, JSON.parse(new TextDecoder().decode(buf)), el('stage'));
  el('film').hidden = false;
  audio.src = URL.createObjectURL(new Blob([master], { type: 'audio/wav' }));
  const opts = {};
  let priorScene;
  const reference=document.createElement('a');
  if(part2 && part2 !== 'part2-demo'){reference.target='_blank';reference.rel='noopener noreferrer';reference.onclick=()=>audio.pause();el('layers').after(reference)}
  const listening={
    'breathe-intro':['jcz0YxYl6Ac',1],'breathe-vamp':['jcz0YxYl6Ac',1],'breathe-chorus':['jcz0YxYl6Ac',61],'breathe-compare':['jcz0YxYl6Ac',1],
    'colour-intro':['l8pEjmZVx3k',72],'colour-handover':['l8pEjmZVx3k',72],'colour-echo':['l8pEjmZVx3k',10],'colour-solo':['l8pEjmZVx3k',124],'colour-outro':['l8pEjmZVx3k',192],'colour-compare':['l8pEjmZVx3k',124],
    'gig-intro':['pbFEVpdKTeE',67],'gig-entry':['pbFEVpdKTeE',63],'gig-exit':['pbFEVpdKTeE',128],'gig-compare':['pbFEVpdKTeE',67]
  };
  function paint() {
    const t = Math.min(model.durationMs - 0.001, audio.currentTime * 1000), s = active(model.scenes, t);
    draw(t, opts);
    if(part2 && part2 !== 'part2-demo' && priorScene !== s.id){
      priorScene=s.id;const target=listening[s.id];reference.hidden=!target;
      if(target){const [video,sec]=target;reference.href='https://www.youtube.com/watch?v='+video+'&t='+sec+'s';
        reference.textContent='暂停讲解，听官方录音 · '+Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0')+' 附近 ↗'}
    }
    scene.value = s.id;
    status.textContent = sourceLabel(s);
  }
  for (
    const [key, label] of Object.entries({
      waveform: '波形',
      chroma: '色度',
      reference: '和弦内音',
      cues: '字幕',
    })
  ) {
    const l = document.createElement('label'), box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = true;
    box.onchange = () => {
      opts[key] = box.checked;
      paint();
    };
    l.append(box, label);
    el('layers').append(l);
  }
  el('theme').onchange = (e) => {
    opts.theme = e.target.value;
    paint();
  };
  scene.onchange = () => {
    audio.currentTime = model.scenes.find((s) => s.id === scene.value).startMs / 1000;
    paint();
  };
  let raf;
  function tick() {
    paint();
    if (!audio.paused) raf = requestAnimationFrame(tick);
  }
  audio.onplay = () => {
    cancelAnimationFrame(raf);
    tick();
  };
  audio.onseeked = audio.ontimeupdate = paint;
  paint();
}
start().catch((e) => status.textContent = e.message + (part2 === 'part2-demo' ? '。请先运行 npm run demo' : '。完成打点后运行 npm run v2:prepare'));
