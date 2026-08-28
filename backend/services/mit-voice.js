/**
 * Child of server.js only â€” no extra HTTP port.
 * IndicF5 (ta/te/kn/hi) + Piper (ar UAE, fr, en).
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WORKER = path.join(__dirname, '..', 'mit-voice', 'indic_worker.py');
const INDIC = ['ta', 'te', 'kn', 'hi'];

let proc = null;
let queue = Promise.resolve();
let buf = '';
let waiters = [];
let workerDead = false;

function startWorker() {
  if (proc || workerDead || process.env.VERCEL) return;
  const bin = process.env.PYTHON || 'py';
  const args = bin === 'py' ? ['-3', '-u', WORKER] : ['-u', WORKER];
  try {
    proc = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  } catch (e) {
    workerDead = true;
    return;
  }
  proc.on('error', () => {
    workerDead = true;
    proc = null;
  });
  proc.stderr.on('data', (d) => {
    const s = d.toString().trim();
    if (s) console.log(s);
  });
  proc.stdout.on('data', (d) => {
    buf += d.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      const w = waiters.shift();
      if (!w) continue;
      try {
        w.resolve(JSON.parse(line));
      } catch (e) {
        w.resolve({ ok: false, error: line });
      }
    }
  });
  proc.on('exit', () => {
    proc = null;
    while (waiters.length) {
      waiters.shift().resolve({ ok: false, error: 'mit-voice worker exited' });
    }
  });
}

function send(job, timeoutMs) {
  startWorker();
  if (!proc) return Promise.resolve({ ok: false, error: 'no python' });
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, error: 'mit-voice timeout' }), timeoutMs);
    waiters.push({
      resolve: (v) => {
        clearTimeout(t);
        resolve(v);
      }
    });
    try {
      proc.stdin.write(Buffer.from(JSON.stringify(job) + '\n', 'utf8'));
    } catch (e) {
      clearTimeout(t);
      resolve({ ok: false, error: e.message });
    }
  });
}

function runJob(job, timeoutMs) {
  queue = queue.then(() => send(job, timeoutMs)).catch((e) => ({ ok: false, error: e.message }));
  return queue;
}

async function synthesizeWav(text, language) {
  if (workerDead) return null;
  const ms = INDIC.includes(language) ? 180000 : 90000;
  const res = await runJob({ op: 'tts', text, language }, ms);
  if (!res.ok || !res.path) return null;
  try {
    return fs.readFileSync(res.path);
  } finally {
    try { fs.unlinkSync(res.path); } catch (e) {}
  }
}

async function transcribeWav(audioBuffer, language) {
  if (workerDead) return { transcript: '', confidence: 0, source: 'mit-voice-fail' };
  const tmp = path.join(os.tmpdir(), 'vocalis-stt-' + Date.now() + '.wav');
  fs.writeFileSync(tmp, audioBuffer);
  try {
    const res = await runJob({ op: 'stt', wav: tmp, language }, 120000);
    if (!res.ok) return { transcript: '', confidence: 0, source: 'mit-voice-fail' };
    return { transcript: res.text || '', confidence: 0.8, source: 'indic-conformer' };
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
}

module.exports = { synthesizeWav, transcribeWav };

