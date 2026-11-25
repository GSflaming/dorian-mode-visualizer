import { createStage } from './stage.mjs';
const $=id=>document.getElementById(id);
async function start() {
  const response=await fetch('./output/score.json');
  if (!response.ok) throw new Error('先生成 score.json');
  const score=await response.json();
  await document.fonts.ready;
  const draw=createStage(score,$('stage'));
  const audio=$('audio');
  const select=$('scene');
  const inputs=[...$('visibility').querySelectorAll('input')];
  for (const scene of score.scenes) select.add(new Option(scene.title,scene.id));
  let frame=0;
  function paint() {
    const shown=Object.fromEntries(inputs.map(input=>[input.name,input.checked]));
    const state=draw(audio.currentTime,shown);
    select.value=state.scene;
  }
  function animate() {
    cancelAnimationFrame(frame);
    paint();
    if (!audio.paused&&!audio.ended) frame=requestAnimationFrame(animate);
  }
  function report(error) { $('status').textContent=error?.message??'当前音轨读取失败'; }
  for (const event of ['play','pause','seeked','ended','loadedmetadata']) audio.addEventListener(event,animate);
  audio.addEventListener('error',()=>report(audio.error));
  for (const input of inputs) input.addEventListener('change',paint);
  select.addEventListener('change',()=>{audio.currentTime=score.scenes.find(scene=>scene.id===select.value).start;paint();});
  let generation=0;
  $('audioSource').addEventListener('change',()=>{
    const state={time:audio.currentTime,playing:!audio.paused};
    const requested=++generation;
    audio.src='./output/'+$('audioSource').value;
    audio.addEventListener('loadedmetadata',()=>{
      if (requested!==generation) return;
      audio.currentTime=state.time;
      if (state.playing) audio.play().catch(report);
      paint();
    },{once:true});
  });
  paint();
}
start().catch(error=>{$('status').textContent=error.message;});
