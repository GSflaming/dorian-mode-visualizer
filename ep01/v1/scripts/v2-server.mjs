import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config, output, root, sha, trackPath, tracks } from './v2-audio.mjs';
import { validate } from '../v2/model.mjs';
let saving = false;
export async function v2Route(req, res, url) {
  if (
    url.pathname.startsWith('/api/') && !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host ?? '')
  ) {
    res.writeHead(403).end();
    return true;
  }
  const demo = url.searchParams.get('demo') === '1', dir = demo ? resolve(output, 'demo/tracks') : tracks;
  if (url.pathname === '/api/tracks') {
    const list = (await readdir(dir, { withFileTypes: true })).filter((f) =>
      f.isFile() && /\.(wav|flac)$/i.test(f.name)
    ).map((f) => f.name);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(list));
    return true;
  }
  if (url.pathname === '/api/track') return await trackPath(dir, url.searchParams.get('file'));
  if (url.pathname === '/api/save') {
    if (
      req.method !== 'POST' || req.headers.origin !== 'http://' + req.headers.host ||
      req.headers['content-type'] !== 'application/json'
    ) {
      res.writeHead(403).end();
      return true;
    }
    if (saving) {
      res.writeHead(409).end('正在保存');
      return true;
    }
    saving = true;
    try {
      let size = 0;
      const chunks = [];
      for await (const buf of req) {
        size += buf.length;
        if (size > 2000000) throw Error('配置过大');
        chunks.push(buf);
      }
      const body = Buffer.concat(chunks).toString('utf8');
      const { model, hash } = JSON.parse(body), file = demo ? resolve(output, 'demo/v2.json') : config;
      validate(model, JSON.parse(await readFile(resolve(root, 'config/v2.schema.json'))));
      if (hash !== sha(await readFile(file))) {
        res.writeHead(409).end('配置已更改，请刷新');
        return true;
      }
      const data = JSON.stringify(model, null, 2) + '\n';
      await writeFile(file + '.tmp', data);
      await rename(file + '.tmp', file);
      res.end(sha(data));
    } catch (e) {
      res.writeHead(400).end(e.message);
    } finally {
      saving = false;
    }
    return true;
  }
  if (url.pathname === '/' && ['align', 'v2', 'part2', 'part2-original', 'part2-demo'].includes(url.searchParams.get('mode'))) {
    return resolve(root, 'v2/index.html');
  }
  const path = url.pathname.slice(1);
  if (
    /^(?:part2\/(?:draw|lesson)\.mjs|part2\/recording-bars\.json|v2-stage\.mjs|v2\/(?:ui|align|dsp|model|worker)\.mjs|v2\/style\.css|config\/v2(?:\.schema)?\.json|output\/v2\/(?:(?:demo|part2|part2-original|part2-demo)\/)?(?:manifest\.json|features\.json|master\.wav|Dorian-V2\.mp4)|output\/v2\/(?:demo|part2|part2-original|part2-demo)\/v2\.json)$/
      .test(path)
  ) return resolve(root, path);
}
