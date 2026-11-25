import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const output=fileURLToPath(new URL('../output/',import.meta.url));
const score=JSON.parse(readFileSync(resolve(output,'score.json'),'utf8'));
const expectedFrames=score.frames;
const video=resolve(output,'Dorian-V1.mp4');
const mix=resolve(output,'Dorian-V1-mix.wav');
const guitar=resolve(output,'stems/guitar.flac');
const synth=resolve(output,'stems/synth.flac');

function probe(path) {
  return JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',path],{encoding:'utf8'})).streams;
}
function pcm(path,start,length,rate=12000) {
  const bytes=execFileSync('ffmpeg',['-v','error','-ss',String(start),'-i',path,'-t',String(length),
    '-map','0:a:0','-ac','1','-ar',String(rate),'-f','f32le','-'],{maxBuffer:64*1024*1024});
  return new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);
}
const [picture,sound]=probe(video);
assert.equal(picture.codec_name,'h264');
assert.equal(picture.width,1920);
assert.equal(picture.height,1080);
assert.equal(picture.r_frame_rate,`${score.fps}/1`);
assert.equal(picture.pix_fmt,'yuv420p');
assert.equal(Number(picture.nb_frames),expectedFrames);
assert.equal(sound.codec_name,'aac');
for (const stream of [picture,sound]) {
  assert.equal(Number(stream.start_time),0);
  assert.equal(Number(stream.duration),score.duration);
}
for (const name of ['guitar','synth','bass','drums']) {
  const path=resolve(output,'stems',name+'.flac');
  const [stream]=probe(path);
  assert.equal(stream.codec_name,'flac');
  assert.equal(stream.sample_rate,'48000');
  assert.equal(stream.bits_per_raw_sample,'24');
  assert.equal(Number(stream.duration),score.duration);
  assert.ok(pcm(path,0,score.duration).some(sample=>Math.abs(sample)>.02));
}
const [master]=probe(mix);
assert.equal(master.codec_name,'pcm_s24le');
assert.equal(Number(master.duration),score.duration);

// Detect the authored C and C-sharp in the actual electric guitar export.
const comparison=score.scenes.find(scene=>scene.id==='compare');
const targets=[72,73].map((pitch,i)=>score.notes.guitar.find(note=>
  note.start>=comparison.start+10*i && note.start<comparison.start+10*(i+1) && note.pitch===pitch));
function power(samples,rate,frequency) {
  const phase=2*Math.PI*frequency/rate;
  let re=0,im=0;
  for (let i=0;i<samples.length;i++) {
    const value=samples[i]*(.5-.5*Math.cos(2*Math.PI*i/(samples.length-1)));
    re+=value*Math.cos(i*phase);
    im-=value*Math.sin(i*phase);
  }
  return re*re+im*im;
}
function frequencyAt(samples,reference,rate) {
  let maximum=[-Infinity,0];
  for (let shift=-12;shift<=12;shift+=.5) {
    const frequency=reference+shift;
    const result=power(samples,rate,frequency);
    if (result>maximum[0]) maximum=[result,frequency];
  }
  return maximum[1];
}
const hz=pitch=>440*2**((pitch-69)/12);
const guitarPitches=targets.map(note=>{
  const samples=pcm(guitar,note.start+.19,.27);
  const frequency=frequencyAt(samples,hz(note.pitch),12000);
  assert.ok(Math.abs(1200*Math.log2(frequency/hz(note.pitch)))<32);
  return frequency.toFixed(1);
});
const scale=score.scenes.find(scene=>scene.id==='scale');
const keyNote=score.notes.lead.find(note=>note.start>=scale.start&&note.start<scale.end&&note.pitch===73);
const keyFrequency=frequencyAt(pcm(synth,keyNote.start+.12,.26),hz(keyNote.pitch),12000);
assert.ok(Math.abs(1200*Math.log2(keyFrequency/hz(keyNote.pitch)))<24);

// Compare the decoded AAC against the WAV at widely separated timeline positions.
function nearestLag(reference,candidate,search) {
  let optimal={ offset:0, value:-Infinity };
  for (let offset=-search;offset<=search;offset++) {
    let cross=0,powerA=0,powerB=0;
    for (let i=search;i<Math.min(reference.length,candidate.length)-search;i++) {
      const a=reference[i],b=candidate[i+offset];
      cross+=a*b;powerA+=a*a;powerB+=b*b;
    }
    const value=cross/Math.sqrt(powerA*powerB);
    if (value>optimal.value) optimal={offset,value};
  }
  return optimal;
}
const offsets=[];
for (const time of [2,42.5,87.5,137.5,185]) {
  const a=pcm(mix,time,.5,8000);
  const b=pcm(video,time,.5,8000);
  const result=nearestLag(a,b,112);
  assert.ok(result.value>.97 && Math.abs(result.offset)<=8,`A/V audio changed at ${time}s: ${JSON.stringify(result)}`);
  offsets.push(result.offset/8);
}
const scan=spawnSync('ffmpeg',['-nostats','-hide_banner','-i',video,'-vf','blackdetect=d=0.03:pix_th=0.06',
  '-af','silencedetect=noise=-45dB:d=0.25','-f','null','-'],{encoding:'utf8'});
assert.equal(scan.status,0,scan.stderr);
assert.doesNotMatch(scan.stderr,/black_start:|silence_start:/);
console.log(JSON.stringify({duration:score.duration,frames:expectedFrames,guitarPitchHz:guitarPitches,
  keyboardPitchHz:keyFrequency.toFixed(1),aacOffsetMs:offsets},null,2));
