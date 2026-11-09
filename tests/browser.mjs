import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.mjs': 'text/javascript; charset=utf-8',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  let path = normalize(join(ROOT, rel));
  if (!path.startsWith(ROOT)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const info = await stat(path);
    if (info.isDirectory()) path = join(path, 'index.html');
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const origin = `http://127.0.0.1:${port}`;

const chrome = spawn('google-chrome', [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  `--user-data-dir=${join('/tmp', `chrome-toazw3-${process.pid}`)}`,
  '--remote-debugging-port=0',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

let debugPort = 0;
let chromeLog = '';
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Chrome did not open a debugging port\n${chromeLog}`)), 15000);
  const onData = (chunk) => {
    chromeLog += chunk;
    const match = chromeLog.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/);
    if (match) {
      debugPort = Number(match[1]);
      clearTimeout(timer);
      resolve();
    }
  };
  chrome.stderr.on('data', onData);
  chrome.stdout.on('data', onData);
  chrome.on('exit', (code) => reject(new Error(`Chrome exited ${code}\n${chromeLog}`)));
});

async function openPage(url) {
  const created = await fetch(`http://127.0.0.1:${debugPort}/json/new?${url}`, { method: 'PUT' });
  if (!created.ok) throw new Error(`Could not open ${url}: ${created.status} ${await created.text()}`);
  const page = await created.json();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
  return { ws, send, page };
}

async function waitFor(send, expression, label) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < 30000) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true });
    last = result.result && result.result.value ? String(result.result.value) : '';
    if (last && !last.startsWith('running') && !last.startsWith('loading')) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} timed out: ${last}`);
}

try {
  const harness = await openPage(`${origin}/tests/harness.html`);
  const harnessResult = await waitFor(harness.send, 'document.querySelector("#result").textContent', 'harness');
  console.log(`harness: ${harnessResult.split('\n')[0]}`);
  if (!harnessResult.startsWith('PASS')) throw new Error(harnessResult);

  const ui = await openPage(`${origin}/`);
  const uiResult = await waitFor(
    ui.send,
    `(() => {
      const status = document.querySelector('#engine-status');
      if (!status || !/ready/i.test(status.textContent)) {
        return 'loading ' + location.href + ' | ' + (status ? status.textContent : document.body && document.body.innerText.slice(0, 180));
      }
      const radios = [...document.querySelectorAll('input[name="output-format"]')].map((input) => input.value + (input.checked ? '*' : ''));
      const accept = document.querySelector('#file-input').accept;
      const button = document.querySelector('#convert-btn').textContent;
      if (!accept.includes('.azw3') || !accept.includes('.epub') || !accept.includes('.mobi')) return 'FAIL accept ' + accept;
      if (radios.join(',') !== 'azw3*,epub,mobi') return 'FAIL radios ' + radios.join(',');
      if (button !== 'Convert to AZW3') return 'FAIL button ' + button;
      document.querySelector('input[value="mobi"]').click();
      const after = document.querySelector('#convert-btn').textContent;
      if (after !== 'Convert to MOBI') return 'FAIL after mobi ' + after;
      document.querySelector('input[value="epub"]').click();
      const epub = document.querySelector('#convert-btn').textContent;
      if (epub !== 'Convert to EPUB') return 'FAIL after epub ' + epub;
      return 'PASS ' + radios.join(',');
    })()`,
    'ui',
  );
  console.log(`ui: ${uiResult}`);
  if (!uiResult.startsWith('PASS')) throw new Error(uiResult);
} finally {
  chrome.kill();
  server.close();
}
