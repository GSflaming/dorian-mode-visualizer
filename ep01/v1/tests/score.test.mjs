import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanvas } from '@napi-rs/canvas';
import { buildScore, chordFor, modes, RATE, tuning } from '../score.mjs';
import { createStage } from '../stage.mjs';
import { guitarGesture } from '../vendor/dream-theater/presentation.mjs';

const config=JSON.parse(readFileSync(new URL('../config/film.json',import.meta.url)));
const score=buildScore(config);
const scene=id=>score.scenes.find(item=>item.id===id);
function inRange(track, from, to) {
  return score.notes[track].filter(note=>note.start>=from && note.start<to);
}
const signature=(notes,start)=>notes.map(note=>[note.start-start,note.end-start,note.pitch,note.velocity]);

test('score keeps 7 scene boundaries aligned to audio samples, 30 fps and four-beat bars',()=>{
  assert.deepEqual(score.scenes.map(item=>item.start),[0,20,40,60,85,115,170]);
  assert.equal(score.duration,195);
  assert.equal(score.frames,5850);
  for (const notes of Object.values(score.notes)) {
    assert.ok(notes.length>0);
    for (const note of notes) {
      assert.ok(note.end<=score.duration && note.end>note.start);
      assert.ok(Math.abs(note.start*RATE-Math.round(note.start*RATE))<1e-7);
    }
  }
  for (const bar of score.bars) {
    assert.equal(bar.end-bar.start,2.5);
    assert.ok(Number.isInteger(bar.start*score.fps));
  }
});

test('both comparison halves share the same accompaniment and differ only at C/C-sharp',()=>{
  const part=scene('compare');
  for (const track of ['guitar','pad','poly','lead','bass','drums']) {
    const first=signature(inRange(track,part.start,part.start+10),part.start);
    const second=signature(inRange(track,part.start+10,part.end),part.start+10);
    if (track==='guitar') first.forEach(event=>{if(event[2]===72)event[2]=73;});
    assert.deepEqual(first,second,track);
  }
});
test('visible scale demonstration plays E Dorian up on both guitar and keys',()=>{
  const part=scene('scale');
  const expected=[4,6,7,9,11,1,2,4];
  const guitar=inRange('guitar',part.start,part.start+5);
  const keys=inRange('lead',part.start+5,part.start+10);
  assert.deepEqual(guitar.map(note=>note.pitch%12),expected);
  assert.deepEqual(keys.map(note=>note.pitch%12),expected);
  assert.deepEqual(modes.dorian.pitches,expected.slice(0,7));
  assert.deepEqual(modes.aeolian.pitches,[4,6,7,9,11,0,2]);
});

test('guitar pitches match the performance fingering and A7 targets the natural sixth',()=>{
  for (const note of score.notes.guitar) assert.equal(note.pitch,tuning[6-note.string]+note.fret);
  assert.deepEqual(chordFor('A7').tones.map(tone=>tone.pc),[9,1,4,7]);
  const part=scene('improv');
  const afterSlide=part.start+13*2.5;
  const target=score.notes.guitar.find(note=>note.start===afterSlide);
  assert.equal(target.pitch%12,1);
  assert.equal(target.techniques.slide.fromFret,target.fret+1);
  assert.equal(guitarGesture(target,afterSlide).fret,target.fret+1);
  assert.equal(guitarGesture(target,afterSlide+.20).fret,target.fret);
});

test('complete keyboard range and separate render-layer filtering',()=>{
  for (const track of ['pad','poly','lead']) {
    for (const note of score.notes[track]) assert.ok(note.pitch>=48&&note.pitch<=88);
  }
  const draw=createStage(score,createCanvas(1920,1080));
  const simultaneous=draw(10.07);
  assert.ok(simultaneous.guitar.length>0);
  assert.ok(simultaneous.keys.some(([track])=>track==='pad'));
  assert.ok(simultaneous.keys.some(([track])=>track==='poly'));
  assert.deepEqual(draw(10.07,{guitar:false}).guitar,[]);
  assert.deepEqual(draw(10.07,{keys:false}).keys,[]);
  assert.ok(draw(10.07,{pad:false}).keys.every(([track])=>track!=='pad'));
  assert.equal(draw(60).chord,'Em7');
  assert.equal(draw(65).chord,'A7');
  assert.equal(draw(82).scene,'harmony');
});

test('playing fret and slide gestures stay in the camera at every encoded frame',()=>{
  const noop=()=>{};
  const context=new Proxy({measureText:text=>({width:text.length*20})},{get:(target,key)=>target[key]??noop});
  const draw=createStage(score,{getContext:()=>context});
  for (let frame=0;frame<score.frames;frame++) {
    const time=frame/score.fps;
    const {camera}=draw(time);
    for (const note of score.notes.guitar.filter(note=>note.start<=time&&time<note.end)) {
      const fret=guitarGesture(note,time).fret;
      assert.ok(fret>=camera[0]-.25&&fret<=camera[1]+.25,`fret ${fret} outside ${camera} at ${time}`);
    }
  }
});
