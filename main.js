const { app, BrowserWindow, ipcMain, safeStorage, dialog } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os');
const keyFile = () => path.join(app.getPath('userData'), 'keys.bin');
let win;
process.on('uncaughtException', e => { try { dialog.showErrorBox('NEXUS AI crashed', String(e.stack || e)); } catch {} });
app.whenReady().then(() => {
  win = new BrowserWindow({ width: 1280, height: 800, minWidth: 980, minHeight: 640, frame: false,
    backgroundColor: '#000608', title: 'NEXUS AI',
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-fail-load', (_, c, d) => dialog.showErrorBox('Failed to load UI', c + ' ' + d));
  win.webContents.on('preload-error', (_, p, e) => dialog.showErrorBox('Preload error', String(e)));
  win.webContents.on('before-input-event', (_, i) => { if (i.type === 'keyDown' && i.key === 'F12') win.webContents.toggleDevTools(); });
  win.loadFile(path.join(__dirname, 'index.html'));
});
app.on('window-all-closed', () => app.quit());

const readKeys = () => { try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(keyFile()))); } catch { return {}; } };
ipcMain.handle('keys:get', () => readKeys());
ipcMain.handle('keys:set', (_, k) => { fs.mkdirSync(path.dirname(keyFile()), { recursive: true }); fs.writeFileSync(keyFile(), safeStorage.encryptString(JSON.stringify(k))); return true; });
ipcMain.on('win', (_, a) => { if (a === 'min') win.minimize(); else if (a === 'max') win.isMaximized() ? win.unmaximize() : win.maximize(); else win.close(); });

let prev = os.cpus();
ipcMain.handle('stats', () => {
  const cur = os.cpus(); let idle = 0, tot = 0;
  cur.forEach((c, i) => { const p = prev[i]; for (const t in c.times) tot += c.times[t] - p.times[t]; idle += c.times.idle - p.times.idle; });
  prev = cur;
  return { cpu: Math.round(100 * (1 - idle / (tot || 1))), ram: Math.round(100 * (1 - os.freemem() / os.totalmem())), up: Math.floor(os.uptime() / 60) };
});

// All AI calls run here (main process) so API keys never touch page scripts and CORS is not an issue.
ipcMain.handle('ai', async (_, { provider, model, messages, system, baseUrl }) => {
  const key = readKeys()[provider];
  if (!key && provider !== 'local') return { error: `No API key saved for ${provider}. Open Config and add one.` };
  try {
    let r, j;
    if (provider === 'local') {
      const base = (baseUrl || 'http://localhost:1234/v1').replace(/\/$/, '');
      let mdl = model;
      if (!mdl) { const mj = await (await fetch(base + '/models')).json(); mdl = mj.data[0].id; }
      r = await fetch(base + '/chat/completions', { method: 'POST',
        headers: Object.assign({ 'content-type': 'application/json' }, key ? { authorization: 'Bearer ' + key } : {}),
        body: JSON.stringify({ model: mdl, messages: [{ role: 'system', content: system }, ...messages] }) });
      j = await r.json(); if (!r.ok) throw new Error(j.error?.message || r.status);
      return { text: j.choices[0].message.content };
    }
    if (provider === 'claude') {
      r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 4096, system, messages }) });
      j = await r.json(); if (!r.ok) throw new Error(j.error?.message);
      return { text: j.content.map(b => b.text || '').join('') };
    }
    if (provider === 'gpt') {
      r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, ...messages] }) });
      j = await r.json(); if (!r.ok) throw new Error(j.error?.message);
      return { text: j.choices[0].message.content };
    }
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] },
        contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })) }) });
    j = await r.json(); if (!r.ok) throw new Error(j.error?.message);
    return { text: j.candidates[0].content.parts.map(p => p.text || '').join('') };
  } catch (e) { return { error: provider === 'local' && /fetch failed/.test(e.message) ? "local: can't reach the server. In LM Studio open the Developer tab, load a model and turn on Start Server (Ollama: make sure it is running)." : `${provider}: ${e.message}` }; }
});
