import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {v2Route} from './v2-server.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const types={'.css':'text/css','.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json',
  '.flac':'audio/flac','.wav':'audio/wav','.mp4':'video/mp4'};
const allowed=/^(?:index\.html|(?:preview|stage|score)\.mjs|vendor\/dream-theater\/[\w/.-]+\.mjs|config\/phrases\.mjs|output\/(?:score\.json|Dorian-V1(?:-mix\.wav|\.mp4)|stems\/(?:synth|guitar|bass|drums)\.flac))$/;
const server=createServer(async (req,res)=>{

  try {
    const url=new URL(req.url,'http://localhost');
    if (!['GET','HEAD'].includes(req.method) && !(req.method==='POST' && url.pathname==='/api/save')) return res.writeHead(405).end();
    const routed=await v2Route(req,res,url);
    if(routed===true)return;
    const request=url.pathname;
    const path=request==='/'?'index.html':decodeURIComponent(request.slice(1));
    if ((!routed && !allowed.test(path))||path.split('/').some(part=>part==='..'||part==='.')) return res.writeHead(404).end();
    const file=routed??resolve(root,path);
    const {size}=await stat(file);
    const headers={'Content-Type':types[extname(file)],'Content-Length':size,'Cache-Control':'no-store','Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff'};
    const range=req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
    let start=0,end=size-1,status=200;
    if (range) {
      if (range[1]) {
        start=Number(range[1]);
        if (range[2]) end=Math.min(end,Number(range[2]));
      } else if (range[2]) start=Math.max(0,size-Number(range[2]));
      if (start>end) return res.writeHead(416,{'Content-Range':`bytes */${size}`}).end();
      status=206;
      headers['Content-Range']=`bytes ${start}-${end}/${size}`;
      headers['Content-Length']=end-start+1;
    }
    res.writeHead(status,headers);
    if (req.method==='HEAD') return res.end();
    const stream=createReadStream(file,{start,end});
    stream.on('error',()=>res.destroy());
    res.on('close',()=>stream.destroy());
    stream.pipe(res);
  } catch { res.writeHead(404).end(); }
});
const port=Number(process.env.DORIAN_PORT??(process.argv.includes('--part2')?4183:process.argv.includes('--align')?4182:4181));
server.listen(port,'127.0.0.1',()=>console.log(`Dorian · http://127.0.0.1:${server.address().port}/${process.argv.includes('--part2')?'?mode=part2':process.argv.includes('--align')?'?mode=align':process.argv.includes('--demo')?'?mode=part2-demo':''}`));
