import { mkdir, writeFile } from 'node:fs/promises';

const endpoint = 'http://127.0.0.1:9333';
const outputDir = new URL('./visual-check/', import.meta.url);
await mkdir(outputDir, { recursive: true });

for (let attempt = 0; attempt < 30; attempt += 1) {
  try {
    await fetch(endpoint + '/json/version');
    break;
  } catch {
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

const target = await fetch(endpoint + '/json/new?http://127.0.0.1:5174/%23jobs', { method: 'PUT' }).then(r => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await wait(1200);
await send('Runtime.evaluate', { expression: "document.querySelector('.singularity-footer button')?.click()" });
await wait(1100);

async function capture(name) {
  await send('Runtime.evaluate', { expression: 'window.scrollTo(0, 0)' });
  await wait(250);
  const metrics = await send('Page.getLayoutMetrics');
  const height = Math.min(12000, Math.ceil(metrics.cssContentSize.height));
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 1280, height, scale: 1 }
  });
  await writeFile(new URL(name + '.png', outputDir), Buffer.from(shot.data, 'base64'));
}

await capture('jobs');
for (const [name, label] of [['profile', '能力档案'], ['matches', '匹配报告'], ['paths', '成长路径']]) {
  await send('Runtime.evaluate', {
    expression: "Array.from(document.querySelectorAll('.exploration-nav-item')).find(el => el.textContent.includes(" + JSON.stringify(label) + "))?.click()"
  });
  await wait(1100);
  await capture(name);
  if (name === 'profile') {
    await send('Runtime.evaluate', {
      expression: "Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('确认完整画像'))?.click()"
    });
    await wait(300);
  }
}

ws.close();
