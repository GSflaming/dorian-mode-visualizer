import { drawGuitar, drawKeys, guitarGesture } from './vendor/dream-theater/presentation.mjs';
import { notesAt } from './vendor/dream-theater/performance-model.mjs';
import { display, pc } from './vendor/dream-theater/theory.mjs';
import { fullName, noteName } from './vendor/dream-theater/vendor/fret-note/music.mjs';
import { chordFor, instruments, modes, tuning } from './score.mjs';

export const WIDTH = 1920;
export const HEIGHT = 1080;
const dark = { bg:'#141c2b', panel:'#1e293a', ink:'#f1f4f9', quiet:'#b5c0d0', hair:'#38485d', string:'#647187',
  nut:'#8494a9', scale:'#4d5a70', chord:'#7895b7', blue:'#597ff2', red:'#ed7359', green:'#4cafac', purple:'#a486d7',
  ivory:'#e9edf4', whiteOutside:'#bbc4d1', blackKey:'#293648', keyOutline:'#45566e' };
const light = { bg:'#f7f8fb', panel:'#fff', ink:'#19263b', quiet:'#526079', hair:'#dce3ed', string:'#9aa8bc',
  nut:'#6b7e9a', scale:'#d8e2f0', chord:'#86a4cd', blue:'#285aca', red:'#b74429', green:'#168286', purple:'#6c55b0',
  ivory:'#fff', whiteOutside:'#e4eaf2', blackKey:'#2c3a50', keyOutline:'#c8d2e1' };
const fonts = '"Hiragino Sans GB", "PingFang SC", "Noto Sans CJK SC", "Helvetica Neue", sans-serif';
const degreeLabels = ['1','2','♭3','4','5','6','♭7'];
const blackPitches = new Set([1,3,6,8,10]);
const clamp = (value,min=0,max=1) => Math.max(min,Math.min(max,value));
const lerp = (a,b,value) => a+(b-a)*value;
const ease = value => { const n=clamp(value); return n*n*(3-2*n); };

function text(ctx, value, x, y, size, color, { weight=550, align='left', maxWidth } = {}) {
  const mainFont = `${Math.round(weight/100)*100} ${size}px ${fonts}`;
  ctx.font = mainFont;
  ctx.textAlign=align;
  ctx.textBaseline='middle';
  ctx.fillStyle=color;
  if (value.includes('♮')) {
    const symbolFont = `400 ${size}px "Apple Symbols", "Noto Music", sans-serif`;
    const runs = value.split(/(♮)/).filter(Boolean).map(content => {
      const font = content === '♮' ? symbolFont : mainFont;
      ctx.font = font;
      return { content, font, width: ctx.measureText(content).width };
    });
    const total = runs.reduce((sum,run)=>sum+run.width,0);
    const width = Math.min(total,maxWidth??total);
    const scale=width/total;
    let cursor=x-(align==='center'?width/2:align==='right'?width:0);
    ctx.textAlign='left';
    for (const run of runs) {
      ctx.font=run.font;
      ctx.fillText(run.content,cursor,y,run.width*scale);
      cursor+=run.width*scale;
    }
    return;
  }
  if (maxWidth) ctx.fillText(value,x,y,maxWidth);
  else ctx.fillText(value,x,y);
}
function rect(ctx,x,y,w,h,fill,stroke, radius=14) {
  ctx.beginPath();
  ctx.roundRect(x,y,w,h,radius);
  if (fill) { ctx.fillStyle=fill; ctx.fill(); }
  if (stroke) { ctx.lineWidth=1.25; ctx.strokeStyle=stroke; ctx.stroke(); }
}
function segment(ctx,x,y,x2,y2,color,width=1) {
  ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();
}
function circle(ctx,x,y,r,color,stroke) {
  ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);
  if (color) {ctx.fillStyle=color;ctx.fill();}
  if (stroke) {ctx.lineWidth=1.5;ctx.strokeStyle=stroke;ctx.stroke();}
}
const timestamp = seconds => `${Math.floor(seconds/60)}:${String(Math.floor(seconds)%60).padStart(2,'0')}`;
const isSixth = pitch => pc(pitch) === 1;
const isRoot = pitch => pc(pitch) === 4;
const playedColor = (p, pitch, chord, mode) => isSixth(pitch) ? p.red :
  mode === modes.aeolian && pc(pitch) === 0 ? p.purple :
  chord.tones.some(tone => tone.pc === pc(pitch)) ? p.blue : p.green;
const keyColor = (p,note) => isSixth(note.pitch) ? p.red : isRoot(note.pitch) ? p.blue :
  ({pad:p.green,poly:p.green,lead:p.purple}[note.track]);
const associated = (mode,pitch) => mode.labels[mode.pitches.indexOf(pc(pitch))] ?? noteName(pitch);

function cameraFor(bar, guitar) {
  const relevant = guitar.filter(note => note.start >= bar.start && note.start < bar.end);
  const frets = relevant.flatMap(note=>[note.fret,note.techniques?.slide?.fromFret??note.fret,note.techniques?.slide?.toFret??note.fret]);
  const range = bar.sceneId === 'scale' ? 9 : bar.sceneId === 'improv' ? 10 : 13;
  if (!frets.length) return [Math.max(0,8-range),Math.max(10,range)];
  const min = Math.min(...frets);
  const max = Math.max(...frets);
  const start = Math.max(0,Math.min(min-2,Math.floor((min+max-range)/2)));
  return [start,Math.min(24,Math.max(start+range,max+2))];
}

function keyPositions(x,width) {
  const white = [];
  const black = [];
  const lowest=48, highest=88;
  const count=Array.from({length:highest-lowest+1},(_,i)=>i+lowest).filter(pitch=>!blackPitches.has(pc(pitch))).length;
  const spacing=width/count;
  for (let pitch=lowest;pitch<=highest;pitch++) {
    const darkKey=blackPitches.has(pc(pitch));
    if (!darkKey) white.push({pitch,x:x+white.length*spacing,width:spacing-1.3,darkKey});
    else black.push({pitch,x:x+(white.length-.31)*spacing,width:.62*spacing,darkKey});
  }
  return [...white,...black];
}

function paintKeyBed(ctx,camera,keys,p,state) {
  const {x,y,w,h} = camera;
  const {mode,chord,time,activeKeys,releasedKeys} = state;
  const now = new Map();
  for (const note of activeKeys) now.set(note.pitch,note);
  const ending = new Map();
  for (const note of releasedKeys) if (!now.has(note.pitch)) ending.set(note.pitch,note);
  const chordClasses = chord.tones.map(tone=>tone.pc);
  ctx.fillStyle=p.panel;
  ctx.fillRect(x-2,y-2,w+4,h+8);
  for (const key of keys) {
    const {pitch,darkKey,width,x: left} = key;
    const active=now.get(pitch);
    const release=ending.get(pitch);
    const inside=mode.pitches.includes(pc(pitch));
    const inChord=chordClasses.includes(pc(pitch));
    const accent=isSixth(pitch) ? p.red : isRoot(pitch) ? p.blue : p.green;
    const hit=active ? clamp(1-(time-active.start)/.22) : 0;
    const base=darkKey?p.blackKey:inside?p.ivory:p.whiteOutside;
    const fullHeight=darkKey?h*.61:h;
    const pressY=y+(active?3:0);
    const center=left+width/2;
    rect(ctx,left,pressY,width,fullHeight-(active?3:0),base,p.keyOutline,3);
    if (inChord && inside && !active) {
      ctx.globalAlpha=darkKey?.70:.38;
      rect(ctx,left+2,pressY+3,width-4,fullHeight-6,accent,null,3);
      ctx.globalAlpha=1;
    }
    if (active || release) {
      const note=active??release;
      ctx.globalAlpha=active? .78+.22*hit : .60*clamp(1-(time-note.end)/.22);
      rect(ctx,left+1,pressY+1,width-2,fullHeight-2,keyColor(p,note),null,3);
      ctx.globalAlpha=1;
    }
    if (inside && (pitch>=60 && pitch<=71 || active || isRoot(pitch) || isSixth(pitch))) {
      const ink=active||darkKey?'#fff':pitch===60&&mode===modes.aeolian?p.purple:isSixth(pitch)?p.red:isRoot(pitch)?p.blue:p.quiet;
      text(ctx,associated(mode,pitch),center,pressY+fullHeight-(darkKey?15:26),darkKey?14:16,ink,{align:'center',weight:700});
    }
    if (pc(pitch)===0 && !darkKey) text(ctx,fullName(pitch),center,pressY+fullHeight-10,10,active?'#fff':p.quiet,{align:'center'});
  }
}
function keyPanel(ctx, panel, p, state) {
  const { x,y,w,h }=panel;
  rect(ctx,x,y,w,h,p.panel,p.hair);
  text(ctx,'合成器',x+25,y+32,24,p.ink,{weight:700});
  const channels=['pad','poly','lead'];
  channels.forEach((track,i)=>{
    const current=state.activeKeys.some(note=>note.track===track);
    const offset=x+w-422+i*132;
    circle(ctx,offset,y+32,current?5:3.5,current?(track==='lead'?p.purple:p.green):p.hair);
    text(ctx,instruments[track].label,offset+12,y+32,15,current?p.ink:p.quiet);
  });
  drawKeys(ctx,state.time,state.keyboard,{left:x+29,right:x+w-30,hitX:x+w*.43,y:y+100,speed:223,
    center:68,pitchScale:1.75,hair:p.hair,color:note=>keyColor(p,note)});
  const bed={x:x+28,y:y+159,w:w-55,h:h-184};
  paintKeyBed(ctx,bed,keyPositions(bed.x,bed.w),p,state);
}

function guitarPanel(ctx, panel, p, state) {
  const { x,y,w,h }=panel;
  rect(ctx,x,y,w,h,p.panel,p.hair);
  text(ctx,'电吉他',x+25,y+32,24,p.ink,{weight:700});
  const current=state.activeGuitar.at(-1);
  if (current) {
    const gesture=guitarGesture(current,state.time);
    const pitch=current.pitch+Math.round(gesture.fret-current.fret+gesture.bend);
    const tone=state.chord.tones.find(t=>t.pc===pc(pitch));
    const functionName=isSixth(pitch) && tone?.degree===3 ? 'A7 三音 · 自然六级' : tone ? `${state.chord.symbol} 和弦音` : '经过 / 色彩音';
    text(ctx,`${fullName(pitch)}   ${functionName}`,x+w-24,y+33,21,playedColor(p,pitch,state.chord,state.mode),{align:'right',weight:700});
  } else if (!state.hasGuitarPhrase) text(ctx,'听合成器声部',x+w-24,y+33,18,p.quiet,{align:'right'});
  drawGuitar(ctx,state.time,state.guitar,state.activeGuitar,state.chord,{
    x:x+23,width:w-44,y:y+81,height:h-124,range:state.camera,palette:p,released:state.releasedGuitar,releaseWindow:.18,
    active:(pitch)=>playedColor(p,pitch,state.chord,state.mode),
    reference(pitch,tone) {
      if (!state.mode.pitches.includes(pc(pitch))) return null;
      if (isSixth(pitch)) return {radius:tone?6:4,fill:tone?p.red:null,stroke:p.red};
      if (isRoot(pitch)) return {radius:5,fill:tone?p.chord:null,stroke:p.blue};
      return {radius:tone?4.5:3.1,fill:tone?p.chord:p.scale};
    },
    degree(pitch,tone) {
      return isSixth(pitch) ? tone?.degree===3 ? '6 · 3' : '6' :
        degreeLabels[state.mode.pitches.indexOf(pc(pitch))] ?? tone?.interval;
    },
  });
}

function scaleRow(ctx,p,state,x,y) {
  state.mode.labels.forEach((name,i)=>{
    const left=x+i*54;
    const pitch=state.mode.pitches[i];
    const on=state.activeGuitar.concat(state.activeKeys).some(note=>pc(note.pitch)===pitch);
    const color=i===0?p.blue:i===5?state.mode===modes.dorian?p.red:p.purple:p.quiet;
    rect(ctx,left,y,48,60,on?color:p.bg,on?null:p.hair,8);
    text(ctx,name,left+24,y+22,21,on?'#fff':color,{align:'center',weight:700});
    text(ctx,i===5 && state.mode===modes.aeolian?'♭6':degreeLabels[i],left+24,y+44,13,on?'#fff':p.quiet,{align:'center'});
  });
}
function comparePanel(ctx,p,state,x,y) {
  const dorian=state.mode===modes.dorian;
  text(ctx,'听第六级',x,y,28,p.ink,{weight:700});
  for (const [i,mode] of [modes.aeolian,modes.dorian].entries()) {
    const selected=mode===state.mode;
    const row=y+52+i*112;
    const color=i?p.red:p.purple;
    const sounding=selected&&state.activeGuitar.some(note=>pc(note.pitch)===(i?1:0));
    rect(ctx,x,row,382,98,selected?p.bg:p.panel,selected?color:p.hair,12);
    text(ctx,mode.name,x+16,row+36,22,selected?p.ink:p.quiet,{weight:650});
    text(ctx,i?'自然六级':'降六级',x+16,row+68,17,p.quiet);
    if (sounding) circle(ctx,x+321,row+48,35,color);
    text(ctx,i?'C♯':'C♮',x+321,row+48,37,sounding?'#fff':color,{align:'center',weight:750});
  }
  text(ctx,dorian?'与 B 相隔两个半音':'与 B 相隔一个半音',x,y+302,22,p.quiet);
}
function voicePanel(ctx,p,state,x,y) {
  const surface=y+64;
  const from=state.score.bars[state.scene.startBar].voicing;
  const to=state.score.bars[state.scene.startBar+2].voicing;
  const amplitude=ease((state.time-state.bar.start)/.6);
  const activeA=state.chord.symbol==='A7';
  text(ctx,'键盘声部',x,y,27,p.ink,{weight:700});
  text(ctx,'Em7',x+16,surface-9,20,activeA?p.quiet:p.blue);
  text(ctx,'A7',x+360,surface-9,20,activeA?p.red:p.quiet,{align:'right'});
  const yOf=pitch=>surface+27+(64-pitch)*16;
  for (const [i,start] of from.entries()) {
    const end=to[i];
    const startY=yOf(start);
    const endY=yOf(end);
    const common=start===end;
    const accent=isSixth(end)?p.red:common?p.green:p.blue;
    segment(ctx,x+61,startY,x+306,endY,common?p.hair:accent,common?1.5:2);
    text(ctx,fullName(start),x+16,startY,19,p.quiet);
    text(ctx,fullName(end),x+360,endY,19,activeA?accent:p.quiet,{align:'right'});
    if (common || activeA) circle(ctx,x+60+245*(common?.5:amplitude),lerp(startY,endY,common?.5:amplitude),common?4:5,accent);
  }
  text(ctx,'E 与 G 保持  D → C♯',x,y+282,20,p.quiet);
}
function melodyPanel(ctx,p,state,x,y,onKeys) {
  const windowStart=state.time-2.3;
  const windowEnd=state.time+2.95;
  const notes=onKeys?state.keyboard.filter(note=>note.track==='lead'):state.guitar.notes;
  const region=notes.filter(note=>note.end>windowStart&&note.start<windowEnd);
  const width=382;
  const spans=region.map(note=>note.pitch);
  const min=spans.length?Math.min(...spans)-1:59;
  const max=spans.length?Math.max(...spans)+1:77;
  const mapX=t=>x+clamp((t-windowStart)/(windowEnd-windowStart))*width;
  const mapY=pitch=>y+176-clamp((pitch-min)/(max-min))*119;
  text(ctx,onKeys?'合成器旋律':'吉他旋律',x,y,27,p.ink,{weight:700});
  for (const i of [0,1,2,3]) segment(ctx,x,y+52+42*i,x+width,y+52+42*i,p.hair,1);
  for (const note of region) {
    const active=note.start<=state.time&&state.time<note.end;
    ctx.globalAlpha=note.end<=state.time?.45:note.start>state.time?.55:1;
    const noteBar=state.score.bars[Math.min(state.score.bars.length-1,Math.floor(note.start/state.score.barSeconds))];
    const color=playedColor(p,note.pitch,state.chords.get(noteBar.chord),modes[noteBar.mode]);
    segment(ctx,mapX(note.start),mapY(note.pitch),mapX(note.end),mapY(note.pitch),color,active?8:3);
    if (active) circle(ctx,mapX(state.time),mapY(note.pitch),5,color);
    ctx.globalAlpha=1;
  }
  segment(ctx,mapX(state.time),y+43,mapX(state.time),y+190,p.quiet,1);
  text(ctx,'和弦音',x+18,y+232,17,p.quiet);
  circle(ctx,x+5,y+232,4,p.blue);
  text(ctx,'经过音',x+134,y+232,17,p.quiet);
  circle(ctx,x+121,y+232,4,p.green);
  text(ctx,'C♯',x+250,y+232,17,p.quiet);
  circle(ctx,x+237,y+232,4,p.red);
}

function sidebar(ctx,box,p,state,shown) {
  const {x,y,w,h}=box;
  const left=x+28;
  rect(ctx,x,y,w,h,p.panel,p.hair);
  text(ctx,state.mode.name,left,y+37,25,p.ink,{weight:700});
  text(ctx,state.mode.chinese,x+w-27,y+38,17,p.quiet,{align:'right'});
  scaleRow(ctx,p,state,left,y+69);
  segment(ctx,left,y+159,x+w-28,y+159,p.hair);
  if (state.scene.view==='compare') comparePanel(ctx,p,state,left,y+204);
  else if (state.scene.view==='harmony') voicePanel(ctx,p,state,left,y+204);
  else if (state.scene.view==='case') {
    text(ctx,'原曲的和声线索',left,y+205,26,p.ink,{weight:700});
    text(ctx,'Em',left,y+269,43,p.blue,{weight:700});
    text(ctx,'→',left+97,y+269,37,p.quiet);
    text(ctx,'A7',left+168,y+269,43,p.red,{weight:700});
    text(ctx,'听觉重心回到 E',left,y+325,21,p.quiet);
    text(ctx,'A7 的三音  C♯',left,y+367,23,p.red,{weight:650});
    text(ctx,'原创教学示范',left,y+425,18,p.quiet);
  } else if (shown.keys&&shown.lead&&(!shown.guitar||!state.hasGuitarPhrase)) {
    melodyPanel(ctx,p,state,left,y+204,true);
  } else if (shown.guitar) melodyPanel(ctx,p,state,left,y+204,false);
  else {
    text(ctx,'贝斯与节拍',left,y+212,27,p.ink,{weight:700});
    text(ctx,'E · G · C♯',left,y+292,35,p.blue,{weight:700});
  }
  text(ctx,`${state.score.bpm} BPM   /   4/4`,left,y+h-35,17,p.quiet);
  const beat=Math.floor(((state.time-state.bar.start)/state.score.quarter)+1e-8);
  for (let i=0;i<4;i++) circle(ctx,x+w-90+i*17,y+h-35,4,i===beat?p.blue:p.hair);
}

function rhythm(ctx,p,state,shown) {
  const x=80,y=873,w=1760,h=92;
  rect(ctx,x,y,w,h,p.panel,p.hair);
  if (shown.bass) {
    const notes=state.score.notes.bass;
    const head=notesAt(notes,state.time).at(-1);
    text(ctx,'贝斯',x+22,y+29,17,p.quiet);
    text(ctx,head?fullName(head.pitch):'—',x+89,y+28,23,head && isRoot(head.pitch)?p.blue:p.ink,{weight:700});
    const from=state.time-1.2,to=state.time+2.2;
    const pos=t=>x+182+clamp((t-from)/(to-from))*553;
    for (const note of notes.filter(note=>note.end>from&&note.start<to)) {
      const yy=y+44-(note.pitch-40)*1.18;
      const hot=note===head;
      segment(ctx,pos(note.start),yy,pos(note.end),yy,hot?p.blue:p.chord,hot?5:3);
    }
    segment(ctx,pos(state.time),y+12,pos(state.time),y+77,p.hair);
  }
  if (shown.drums) {
    segment(ctx,x+782,y+18,x+782,y+h-18,p.hair);
    text(ctx,'鼓 / 本小节',x+810,y+28,17,p.quiet);
    const step=(state.time-state.bar.start)/state.score.barSeconds;
    const start=x+956, span=777;
    const drumNotes=state.score.notes.drums.filter(note=>note.end>state.bar.start&&note.start<state.bar.end);
    for (const note of drumNotes) {
      const left=start+(note.start-state.bar.start)/state.score.barSeconds*span;
      const hot=note.start<=state.time&&state.time-note.start<.24;
      const lane=note.pitch===36?0:note.pitch===38?1:2;
      const color=[p.blue,p.green,p.purple][lane];
      circle(ctx,left,y+24+lane*20,hot?6:3,hot?color:p.hair);
    }
    segment(ctx,start+step*span,y+13,start+step*span,y+78,p.blue,1.2);
  }
}
function progress(ctx,p,state) {
  const x=80,w=1760,y=1014;
  for (const scene of state.score.scenes) {
    const from=x+scene.start/state.score.duration*w;
    const to=x+scene.end/state.score.duration*w;
    segment(ctx,from,y,to-4,y,scene===state.scene?p.chord:p.hair,2.5);
    text(ctx,scene.id==='breathe'?'〈Breathe〉':scene.title,from,y+22,15,scene===state.scene?p.ink:p.quiet,{maxWidth:to-from-9});
  }
  circle(ctx,x+state.time/state.score.duration*w,y,5,p.blue);
  text(ctx,`${timestamp(state.time)} / ${timestamp(state.score.duration)}`,1840,y-22,16,p.quiet,{align:'right'});
}

export function createStage(score,canvas) {
  const ctx=canvas.getContext('2d',{alpha:false});
  const guitar={notes:score.notes.guitar,tuning,lastFret:24};
  const keyTracks=['pad','poly','lead'];
  const allKeyboard=keyTracks.flatMap(track=>score.notes[track]).sort((a,b)=>a.start-b.start||a.pitch-b.pitch);
  const keyTrackOf = Object.fromEntries(keyTracks.map(track=>[track,true]));
  const cameras=score.bars.map(bar=>cameraFor(bar,guitar.notes));
  const hasGuitarPhrase=score.bars.map(bar=>guitar.notes.some(note=>note.start>=bar.start&&note.start<bar.end));
  const guitarSize = (bar,index) => {
    if (bar.sceneId === 'scale') return hasGuitarPhrase[index] ? 238 : 195;
    if (bar.sceneId === 'improv') return hasGuitarPhrase[index] ? 320 : 204;
    return 286;
  };
  const chords=new Map(Array.from(new Set(score.bars.map(bar=>bar.chord)),name=>[name,chordFor(name)]));
  return function draw(seconds, visible={}) {
    const shown={guitar:true,keys:true,bass:true,drums:true,...keyTrackOf,...visible};
    const time=clamp(seconds,0,score.duration-1e-7);
    const index=Math.min(score.bars.length-1,Math.floor((time+1e-8)/score.barSeconds));
    const bar=score.bars[index];
    const scene=score.scenes.find(item=>item.id===bar.sceneId);
    const chord=chords.get(bar.chord);
    const nextBar=score.bars[index+1];
    const localTime=time-bar.start;
    const nextRange=cameras[index+1]??cameras[index];
    const camera=cameras[index].map((edge,i)=>lerp(edge,nextRange[i],ease((localTime-(score.barSeconds-.34))/.34)));
    const p=scene.id==='opening'&&bar.local<2||scene.id==='improv'&&bar.local>=6&&bar.local<16 ? dark : light;
    const keyboard=shown.keys?allKeyboard.filter(note=>shown[note.track]):[];
    const activeKeys=notesAt(keyboard,time);
    const activeGuitar=shown.guitar?notesAt(guitar.notes,time):[];
    const releasedGuitar=shown.guitar?guitar.notes.filter(note=>note.end<=time&&note.end>time-.18):[];
    const releasedKeys=keyboard.filter(note=>note.end<=time&&note.end>time-.22);
    const mode=modes[bar.mode];
    const state={time,bar,scene,chord,chords,score,mode,keyboard,activeKeys,releasedKeys,
      activeGuitar,releasedGuitar,guitar,camera,hasGuitarPhrase:hasGuitarPhrase[index]};
    const cue=scene.cues.findLast(item=>item.at<=time);
    ctx.fillStyle=p.bg;
    ctx.fillRect(0,0,WIDTH,HEIGHT);
    text(ctx,scene.title,80,63,33,p.ink,{weight:750});
    text(ctx,`第 ${bar.local+1} / ${scene.chords.length} 小节`,80,111,17,p.quiet);
    const chordColor=chord.symbol==='A7'?p.red:p.blue;
    text(ctx,chord.symbol,1833,65,55,chordColor,{align:'right',weight:750});
    text(ctx,chord.tones.map(tone=>display(tone.name)).join('   '),1831,111,20,p.quiet,{align:'right'});
    if (nextBar && nextBar.sceneId===scene.id && nextBar.chord!==bar.chord) {
      text(ctx,'→  '+nextBar.chord,1616,69,21,p.quiet,{align:'right'});
    }
    if (cue) {
      const amount=ease((time-cue.at)/.30);
      ctx.globalAlpha=amount;
      const title=scene.id==='opening'&&bar.local===2;
      text(ctx,cue.text,80,164+(1-amount)*8,title?38:32,p.ink,{weight:700,maxWidth:1730});
      if (cue.detail) text(ctx,cue.detail,1839,163,18,p.quiet,{align:'right'});
      ctx.globalAlpha=1;
    } else if (scene.id==='opening') text(ctx,'原创四轨演奏',80,164,20,p.quiet);
    const previousIndex = Math.max(0,index-1);
    const guitarHeight = lerp(guitarSize(score.bars[previousIndex],previousIndex),guitarSize(bar,index),ease(localTime/.42));
    const keyHeight=617-guitarHeight;
    const area={x:80,y:211,w:1275};
    if (shown.guitar) guitarPanel(ctx,{...area,h:shown.keys?guitarHeight:642},p,state);
    if (shown.keys) keyPanel(ctx,{...area,y:shown.guitar?211+guitarHeight+19:211,h:shown.guitar?keyHeight:642},p,state);
    sidebar(ctx,{x:1380,y:211,w:460,h:636},p,state,shown);
    if (shown.bass||shown.drums) rhythm(ctx,p,state,shown);
    progress(ctx,p,state);
    return {scene:scene.id,bar:index,chord:bar.chord,camera,
      guitar:activeGuitar.map(note=>note.pitch),keys:activeKeys.map(note=>[note.track,note.pitch])};
  };
}
