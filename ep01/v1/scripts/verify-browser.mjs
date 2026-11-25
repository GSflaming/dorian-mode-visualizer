import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { chrome } from '../../scripts/chrome.mjs';

const server = spawn(process.execPath, [fileURLToPath(new URL('serve.mjs', import.meta.url)), '--demo'], {
  env: { ...process.env, DORIAN_PORT: '0' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const stopped = once(server, 'close');
let browser;
try {
  const [line] = await Promise.race([
    once(server.stdout, 'data'),
    stopped.then(([code]) => { throw Error('Preview server exited with code ' + code); }),
  ]);
  const url = line.toString().match(/http:\/\/\S+/)[0];
  browser = await chrome();
  await browser.send('Page.navigate', { url });
  const results = await browser.evaluate(`(async () => {
    const waitFor = async (condition) => {
      const deadline = performance.now() + 5000;
      while (!condition()) {
        if (performance.now() > deadline) throw Error(document.getElementById('status')?.textContent || 'Timed out');
        await new Promise((ok) => setTimeout(ok, 25));
      }
    };
    const el = (id) => document.getElementById(id);
    await waitFor(() => el('audio')?.readyState >= 2);
    const audio = el('audio'), scene = el('scene'), canvas = el('stage');
    const digest = (x, y, width, height) => {
      const { data } = canvas.getContext('2d').getImageData(x, y, width, height);
      return crypto.subtle.digest('SHA-256', data).then((hash) => String(new Uint8Array(hash)));
    };
    const seek = async (seconds) => {
      const done = new Promise((ok) => audio.addEventListener('seeked', ok, { once: true }));
      audio.currentTime = seconds;
      await done;
    };
    await seek(1.97);
    const fretBefore = await digest(128, 330, 1664, 230);
    await seek(2.10);
    const fretAfter = await digest(128, 330, 1664, 230);
    await seek(0.4);
    const earlyKeys = await digest(250, 635, 86, 275);
    await seek(2.10);
    const laterKeys = await digest(250, 635, 86, 275);
    let played = false;
    try {
      await audio.play();
      await waitFor(() => audio.currentTime >= 2.35);
      played = true;
    } finally {
      audio.pause();
    }
    scene.value = 'demo-g';
    scene.dispatchEvent(new Event('change'));
    await waitFor(() => Math.abs(audio.currentTime - 9.6) < 0.001 && scene.value === 'demo-g');
    return {
      duration: audio.duration, title: el('title').textContent, played,
      fretChanged: fretBefore !== fretAfter, keysChanged: earlyKeys !== laterKeys,
      scene: scene.value, seek: audio.currentTime,
    };
  })()`, { userGesture: true });
  assert.deepEqual(results, {
    duration: 12.8, title: 'Dorian mode · Synthetic studies', played: true,
    fretChanged: true, keysChanged: true, scene: 'demo-g', seek: 9.6,
  });
  console.log('Browser playback, fretboard, keyboard, and scene seek passed.', results);
} finally {
  if (browser) await browser.close();
  server.kill();
  await stopped;
}
