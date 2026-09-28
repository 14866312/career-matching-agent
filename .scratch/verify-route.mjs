const endpoint = 'http://127.0.0.1:9333';
const target = await fetch(endpoint + '/json/new?http://127.0.0.1:5174/%23matches', { method: 'PUT' }).then(r => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
let nextId = 1; const pending = new Map();
ws.addEventListener('message', event => { const m = JSON.parse(event.data); if (!m.id || !pending.has(m.id)) return; const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); });
function send(method, params = {}) { const id = nextId++; ws.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => pending.set(id, { resolve, reject })); }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
await send('Page.enable'); await send('Runtime.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }); await wait(500);
const rect = await send('Runtime.evaluate', { expression: "(() => { const r = document.querySelector('.singularity-core-button').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()", returnByValue: true });
const { x, y } = rect.result.value; await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await wait(3000); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); await wait(1500);
const result = await send('Runtime.evaluate', { expression: "({ hash: location.hash, active: document.querySelector('.exploration-nav-item.active')?.textContent?.trim() })", returnByValue: true });
console.log(JSON.stringify(result.result.value)); ws.close();
