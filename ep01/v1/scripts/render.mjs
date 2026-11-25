import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createStage, WIDTH, HEIGHT } from '../stage.mjs';

const { values: args } = parseArgs({ options: {
  scene: { type: 'string' }, output: { type: 'string' }, snapshot: { type: 'string' },
  font: { type: 'string' }, duration: { type: 'string' }, start: { type: 'string' },
  'mix-dir': { type: 'string' },
} });
const project = fileURLToPath(new URL('../output/', import.meta.url));
const score = JSON.parse(await readFile(resolve(project,'score.json'),'utf8'));
const canvas = createCanvas(WIDTH, HEIGHT);
const font = args.font ?? process.env.DORIAN_FONT ?? (process.platform === 'darwin'?'/System/Library/Fonts/Hiragino Sans GB.ttc':null);
if (font && !GlobalFonts.registerFromPath(font,'Hiragino Sans GB')) throw new Error('Unable to register CJK font');
if (process.platform === 'darwin') GlobalFonts.registerFromPath('/System/Library/Fonts/Apple Symbols.ttf','Apple Symbols');
const draw = createStage(score,canvas);
if (args.snapshot !== undefined) {
  const time = Number(args.snapshot);
  if (!Number.isFinite(time)||time<0||time>=score.duration) throw new Error('Invalid snapshot time');
  draw(time);
  await writeFile(resolve(args.output ?? resolve(project,'snapshot.png')),canvas.toBuffer('image/png'));
  process.exit(0);
}

const scene = args.scene && score.scenes.find(item=>item.id===args.scene);
if (args.scene && !scene) throw new Error('Unknown scene: '+args.scene);
const fps=score.fps;
const start = Number(args.start ?? scene?.start ?? 0);
const end = scene?.end ?? score.duration;
const duration = Math.min(end-start,Number(args.duration ?? end-start));
const totalFrames = Math.round(duration*fps);
if (!Number.isFinite(start)||start < (scene?.start??0)||!Number.isFinite(duration)||totalFrames<1||
    Math.abs(duration*fps-totalFrames)>1e-7||Math.abs(start*fps-Math.round(start*fps))>1e-7) throw new Error('Choose a valid interval aligned to frame boundaries');

const mixDirectory = resolve(args['mix-dir'] ?? project);
const audio = resolve(mixDirectory,'Dorian-V1-mix.wav');
const settings = JSON.parse(await readFile(resolve(mixDirectory,'mix-settings.json'),'utf8'));
const eventHash = createHash('sha256').update(JSON.stringify([score.duration,score.notes])).digest('hex');
if (settings.eventHash !== eventHash) throw new Error('The music events changed. Regenerate the mix before rendering.');
const metadata = JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','a:0','-show_entries','stream=duration,sample_rate,channels','-of','json',audio],{encoding:'utf8'})).streams[0];
if (!metadata || Math.abs(Number(metadata.duration)-score.duration)>1e-6 || metadata.sample_rate!=='48000' || metadata.channels!==2) {
  throw new Error('Render audio is missing or differs from the score length, sample rate or channel count');
}
const output=resolve(args.output ?? resolve(project,args.scene?`Dorian-${args.scene}.mp4`:'Dorian-V1.mp4'));
await mkdir(dirname(output),{recursive:true});
const temporary=output+`.temp-${process.pid}.mp4`;
const encoder=spawn('ffmpeg',[
  '-y','-v','error','-f','image2pipe','-framerate',String(fps),'-c:v','mjpeg','-i','pipe:0',
  '-ss',String(start),'-i',audio,'-map','0:v:0','-map','1:a:0','-t',String(duration),
  '-vf','scale=in_range=full:out_range=limited:out_color_matrix=bt709,format=yuv420p',
  '-color_range','tv','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709',
  '-c:v','libx264','-preset','veryfast','-crf','17','-c:a','aac','-b:a','320k','-movflags','+faststart',temporary,
],{stdio:['pipe','ignore','inherit']});
let streamError;
encoder.stdin.on('error',error=>{streamError=error;});
const completed=new Promise(done=>{
  encoder.once('error',error=>{streamError=error;});
  encoder.once('close',code=>done(code));
});
try {
  for (let frame=0;frame<totalFrames;frame++) {
    if (streamError || encoder.exitCode!==null) throw streamError??new Error('FFmpeg exited early');
    draw(start+frame/fps);
    const bytes=canvas.toBuffer('image/jpeg',94);
    await new Promise((ok,fail)=>encoder.stdin.write(bytes,error=>error?fail(error):ok()));
    if ((frame+1)%750===0||frame+1===totalFrames) console.log(`${frame+1}/${totalFrames}`);
  }
  encoder.stdin.end();
  const code=await completed;
  if (code!==0||streamError) throw streamError??new Error('FFmpeg encoding failed');
  await rename(temporary,output);
  console.log(output);
} finally {
  if (encoder.exitCode===null&&encoder.signalCode===null) {
    encoder.kill();
    await completed;
  }
  await rm(temporary,{force:true});
}
