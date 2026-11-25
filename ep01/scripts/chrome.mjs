import { spawn } from 'node:child_process';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.platform === 'darwin') {
    const path = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    try { await access(path); return path; } catch { /* use PATH */ }
  }
  if (process.platform === 'win32' && process.env.PROGRAMFILES) {
    const path = join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe');
    try { await access(path); return path; } catch { /* use PATH */ }
  }
  return 'chromium';
}

export async function chrome() {
  const profile = await mkdtemp(join(tmpdir(), 'harmony-chrome-'));
  const browser = spawn(await chromePath(), ['--headless', '--remote-debugging-pipe', '--no-first-run',
    '--disable-background-networking', '--disable-dev-shm-usage', '--no-default-browser-check',
    '--disable-extensions', '--disable-sync', '--force-device-scale-factor=1', `--user-data-dir=${profile}`],
  { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  const completed = new Promise(resolve => browser.once('close', resolve));
  const pending = new Map();
  let buffer = '';
  let errors = '';
  let id = 0;
  const cancel = (reason) => {
    for (const task of pending.values()) { clearTimeout(task.timeout); task.reject(reason); }
    pending.clear();
  };
  browser.stderr.setEncoding('utf8').on('data', chunk => { errors = (errors + chunk).slice(-3000); });
  browser.once('error', error => cancel(error));
  browser.once('close', () => cancel(new Error('Chrome 已退出。' + errors)));
  browser.stdio[3].on('error', error => cancel(error));
  browser.stdio[4].setEncoding('utf8').on('data', (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\0')) >= 0) {
      const packet = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (!packet.id || !pending.has(packet.id)) continue;
      const task = pending.get(packet.id);
      pending.delete(packet.id);
      clearTimeout(task.timeout);
      if (packet.error) task.reject(new Error(packet.error.message));
      else task.resolve(packet.result);
    }
  });
  let sessionId;
  const send = (method, params = {}, session = sessionId) => new Promise((resolve, reject) => {
    if (browser.exitCode !== null) { reject(new Error('Chrome 已退出。' + errors)); return; }
    const request = ++id;
    const timeout = setTimeout(() => { pending.delete(request); reject(new Error(`Chrome ${method} 超时。${errors}`)); }, 20000);
    pending.set(request, { resolve, reject, timeout });
    browser.stdio[3].write(JSON.stringify({ id: request, method, params, sessionId: session }) + '\0');
  });
  const close = async () => {
    if (browser.exitCode === null) browser.kill();
    await completed;
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  };
  try {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
  } catch (error) {
    await close();
    throw error;
  }
  return {
    send, close,
    async evaluate(expression, { userGesture = false } = {}) {
      const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
      return result.value;
    },
  };
}
