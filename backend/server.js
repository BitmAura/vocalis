require('dotenv').config({ path: __dirname + '/.env' });
const http = require('http');
const fs = require('fs');
const path = require('path');
const { handleInboundCall } = require('./routes/telephony');
const { handleChat } = require('./routes/chat');
const { attachMediaStreamServer, generateMediaStreamTwiML } = require('./routes/voice-stream');
const callRecorder = require('./services/call-recorder');
const tenantStore = require('./services/tenant-store');
const bookingEngine = require('./services/booking-engine');
const callLogsStore = require('./services/call-logs-store');
const outboundAutoCall = require('./services/outbound-autocall');
const WhatsAppDispatcher = require('./services/whatsapp-dispatcher');
const VoiceAgentSession = require('./services/voice-agent');

const PORT = process.env.PORT || 3300;
const ROOT_DIR = path.join(__dirname, '..');
const ADMIN_DIR = path.join(ROOT_DIR, 'admin');
const CLIENT_PORTAL_DIR = path.join(ROOT_DIR, 'client-portal');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const whatsAppDispatcher = new WhatsAppDispatcher();


const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || 'http://localhost:3300',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};
const BODY_SIZE_LIMIT = 100 * 1024;

function isAdminAuthorized(req) {
  const key = process.env.ADMIN_API_KEY;
  if (!key) return true;
  const header = req.headers.authorization || '';
  const sent = header.replace(/^Bearer\s+/i, '').trim();
  return sent === key;
}

function rejectUnauthorized(res) {
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'unauthorized' }));
}


function parseRequestBody(req) {
  return new Promise((resolve) => {
    if (req.body !== undefined && req.body !== null) {
      return resolve(req.body);
    }
    let body = '';
    let sz = 0;
    let resolved = false;

    function done(val) {
      if (resolved) return;
      resolved = true;
      resolve(val);
    }

    req.on('data', c => {
      sz += c.length;
      if (sz > BODY_SIZE_LIMIT) {
        req.destroy();
        return done('');
      }
      body += c;
    });
    req.on('end', () => done(body));
    req.on('error', () => done(''));
    // Unconditional safety timeout for serverless environments (never hangs)
    setTimeout(() => done(body), 250);
  });
}

async function requestHandler(req, res) {
  // Support both direct URL and Vercel proxy headers
  const rawUrl = req.headers['x-matched-path'] || req.url || '';
  const parsedUrl = rawUrl.split('?')[0];
  Object.entries(SECURITY_HEADERS).forEach(([k,v]) => res.setHeader(k,v));
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // API Route: Inbound Telephony Webhook (Twilio) Ã¢â‚¬â€ Phase 5 Media Streams
  if (req.method === 'POST' && (parsedUrl === '/v1/telephony/inbound' || parsedUrl.includes('/telephony/inbound') || req.url.includes('/telephony/inbound'))) {
    const rawBody = await parseRequestBody(req);
    let params = {};
    if (typeof rawBody === 'object' && rawBody !== null) {
      params = rawBody;
    } else {
      const bodyStr = String(rawBody || '');
      const ct = req.headers['content-type'] || '';
      if (ct.includes('json')) {
        try { params = JSON.parse(bodyStr); } catch(e) {}
      } else {
        try {
          const urlParams = new URLSearchParams(bodyStr);
          urlParams.forEach((v, k) => { params[k] = v; });
        } catch(e) {}
      }
    }
    try {
      const twiml = await handleInboundCall(params);
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(twiml);
    } catch (err) {
      console.error('[Telephony Error]:', err.message);
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end('<Response><Say>Thank you for calling. Our receptionist is currently on another line.</Say></Response>');
    }
    return;
  }

  // API Route: Twilio Recording Status Callback
  if (req.method === 'POST' && parsedUrl === '/v1/telephony/recording') {
    let body = ''; let sz = 0;
    req.on('data', c => { sz += c.length; if(sz > BODY_SIZE_LIMIT) { req.destroy(); return; } body += c; });
    req.on('end', async () => {
      const params = {};
      try { new URLSearchParams(body).forEach((v, k) => { params[k] = v; }); } catch(e) {}
      const result = await callRecorder.handleRecordingCallback(params);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
    return;
  }

  // API Route: List call recordings
  if (req.method === 'GET' && parsedUrl === '/v1/recordings') {
    const recordings = callRecorder.listRecordings();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(recordings));
    return;
  }

  // API Route: Send Test Doctor WhatsApp Notification
  if (req.method === 'POST' && parsedUrl === '/v1/test/whatsapp') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      let data = {};
      try { data = JSON.parse(body); } catch(e) {}
      const result = await whatsAppDispatcher.sendConfirmedBookingAlert(
        data.doctorPhone || '+44 7911 123456',
        data.bookingDetails || {
          patientName: "Maria Johnson",
          patientPhone: "+44 7700 900123",
          treatment: "Dental Hygiene & Polish",
          treatmentFee: "Ã‚Â£140",
          slotTime: "Friday, 28 Aug at 2:30 PM",
          clinicName: "Harley Street Smiles Dental",
          conversationScript: "Patient booked Friday 2:30 PM slot for teeth cleaning; mentioned mild tooth sensitivity.",
          audioUrl: "https://app.vocalis.ai/recordings/demo_rec.mp3"
        }
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
    return;
  }


  
  // API Route: Get Dispatched Doctor WhatsApp Alerts
  
  // API Route: Active Telephony Routing (Switch phone line to any client tenant)
  if (req.method === 'GET' && parsedUrl === '/v1/telephony/active-tenant') {
    const activeTenantId = tenantStore.getActiveTestTenantId();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ activeTenantId }));
    return;
  }

  if (req.method === 'POST' && parsedUrl === '/v1/telephony/active-tenant') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let data = {};
      try { data = JSON.parse(body); } catch(e) {}
      if (data.activeTenantId) {
        tenantStore.setActiveTestTenantId(data.activeTenantId);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, activeTenantId: tenantStore.getActiveTestTenantId() }));
    });
    return;
  }

  if (req.method === 'GET' && parsedUrl === '/v1/doctor/alerts') {
    const alertsFile = path.join(__dirname, 'data', 'doctor_alerts.json');
    let alerts = [];
    if (fs.existsSync(alertsFile)) {
      try { alerts = JSON.parse(fs.readFileSync(alertsFile, 'utf8')); } catch(e) {}
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, alerts }));
    return;
  }

  // API Route: LLM Chat Engine (Phase 4)
  if (req.method === 'POST' && (parsedUrl === '/v1/chat' || parsedUrl.endsWith('/chat') || req.url.includes('/chat'))) {
    const rawBody = await parseRequestBody(req);
    handleChat(req, res, rawBody);
    return;
  }

  if ((req.method === 'POST' || req.method === 'GET') && parsedUrl === '/v1/tts') {
    const handleTTS = async (text, language) => {
      const tts = require('./services/tts-engine');
      const buf = await tts.synthesize(text || '', language || 'en-GB');
      if (!buf) {
        res.writeHead(204);
        res.end();
        return;
      }
      const isWav = buf.length >= 4 && buf.slice(0, 4).toString('ascii') === 'RIFF';
      res.writeHead(200, { 'Content-Type': isWav ? 'audio/wav' : 'audio/mpeg' });
      res.end(buf);
    };

    if (req.method === 'GET') {
      try {
        const q = new URL(req.url, 'http://' + (req.headers.host || 'localhost')).searchParams;
        handleTTS(q.get('text') || '', q.get('lang') || q.get('language') || 'en-GB');
      } catch(e) {
        res.writeHead(400); res.end();
      }
      return;
    }

    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      let data = {};
      try { data = JSON.parse(body); } catch (e) {}
      handleTTS(data.text || '', data.language || data.lang || 'en-GB');
    });
    return;
  }


  // API Route: Get All Tenants
  if (req.method === 'GET' && (parsedUrl === '/v1/tenants' || parsedUrl.includes('/tenants') || req.url.includes('/tenants'))) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(tenantStore.getAllTenants()));
    return;
  }

  // API Route: Save / Update Tenant & Custom Knowledge Base
  if (req.method === 'POST' && parsedUrl === '/v1/tenants') {
    if (!isAdminAuthorized(req)) { rejectUnauthorized(res); return; }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const saved = tenantStore.saveTenant(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, tenant: saved }));
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }


  // API Route: Delete Tenant by ID
  if (req.method === 'DELETE' && parsedUrl.startsWith('/v1/tenants/')) {
    if (!isAdminAuthorized(req)) { rejectUnauthorized(res); return; }
    const tenantId = parsedUrl.split('/v1/tenants/')[1];
    try {
      const result = tenantStore.deleteTenant(tenantId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch(e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // API Route: Suspend / Reactivate Tenant
  if (req.method === 'PATCH' && parsedUrl.startsWith('/v1/tenants/') && parsedUrl.endsWith('/suspend')) {
    if (!isAdminAuthorized(req)) { rejectUnauthorized(res); return; }
    const tenantId = parsedUrl.split('/v1/tenants/')[1].replace('/suspend','');
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { suspended } = JSON.parse(body || '{}');
        const tenant = tenantStore.suspendTenant(tenantId, !!suspended);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, tenant }));
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // API Route: Get Single Tenant by ID
  if (req.method === 'GET' && parsedUrl.startsWith('/v1/tenants/')) {
    const tenantId = parsedUrl.split('/v1/tenants/')[1];
    const tenant = tenantStore.getTenantById(tenantId);
    if (tenant) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(tenant));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Tenant not found' }));
    }
    return;
  }

  // API Route: Get Confirmed Bookings
  if (req.method === 'GET' && parsedUrl === '/v1/bookings') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(bookingEngine.getAllBookings()));
    return;
  }

  // API Route: Create Booking & Dispatch WhatsApp
  if (req.method === 'POST' && parsedUrl === '/v1/bookings') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const result = await bookingEngine.createBooking(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // API Route: Get Live Call Logs & Analytics
  if (req.method === 'GET' && parsedUrl === '/v1/logs') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      logs: callLogsStore.getAllLogs(),
      metrics: callLogsStore.getSummaryMetrics()
    }));
    return;
  }


  // API Route: Inbound Ad Click or Missed Call Callback Trigger
  if (req.method === 'POST' && parsedUrl === '/v1/ads/missed-call') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const result = await outboundAutoCall.triggerMissedCallCallback(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }


  // API Route: Save Gemini API Key & Activate LLM Brain Live
  if (req.method === 'POST' && parsedUrl === '/v1/settings/gemini-key') {
    if (!isAdminAuthorized(req)) { rejectUnauthorized(res); return; }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { apiKey } = JSON.parse(body);
        if (!apiKey || apiKey.trim().length < 10) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Valid Gemini API key required' }));
          return;
        }

        // 1. Update .env file
        const envPath = path.join(__dirname, '.env');
        let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
        if (envContent.includes('GEMINI_API_KEY=')) {
          envContent = envContent.replace(/GEMINI_API_KEY=.*/g, 'GEMINI_API_KEY=' + apiKey.trim());
        } else {
          envContent += '\nGEMINI_API_KEY=' + apiKey.trim();
        }
        fs.writeFileSync(envPath, envContent, 'utf8');
        process.env.GEMINI_API_KEY = apiKey.trim();

        // 2. Activate llmEngine
        const llmEngine = require('./services/llm-engine');
        llmEngine.apiKey = apiKey.trim();
        llmEngine.available = true;

        console.log('Ã¢Å“â€¦ Gemini API Key saved and LLM Brain activated dynamically!');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Gemini Brain is now ACTIVE' }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }


  // API Route: Save All Platform Keys into .env
  if (req.method === 'POST' && parsedUrl === '/v1/settings/save-all') {
    if (!isAdminAuthorized(req)) { rejectUnauthorized(res); return; }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const keys = JSON.parse(body);
        const backendEnv = path.join(__dirname, '.env');
        const rootEnv = path.join(__dirname, '..', '.env');

        const envText = [
          '# Vocalis AI Ã¢â‚¬â€ Multi-Provider LLM Brain & Voice Telephony',
          '# =========================================================',
          '',
          '# 1. Primary LLM Brain: Google Gemini',
          'GEMINI_API_KEY=' + (keys.geminiKey || ''),
          '',
          '# 2. Failover Cloud GPU: NVIDIA NIM (Llama 3.3 70B)',
          'NVIDIA_API_KEY=' + (keys.nvidiaKey || ''),
          '',
          '# 3. Failover Universal Hub: OpenRouter API',
          'OPENROUTER_API_KEY=' + (keys.openRouterKey || ''),
          '',
          '# 4. Telephony (Twilio)',
          'TWILIO_ACCOUNT_SID=' + (keys.twilioSid || ''),
          'TWILIO_AUTH_TOKEN=' + (keys.twilioToken || ''),
          'TWILIO_PHONE_NUMBER=' + (keys.twilioPhone || ''),
          '',
          '# 5. WhatsApp Delivery',
          'GUPSHUP_API_KEY=' + (keys.gupshupKey || ''),
          'GUPSHUP_APP_NAME=' + (keys.gupshupApp || 'vocalis_ai_receptionist'),
          '',
          '# 6. Real-time STT & High-Fidelity Neural TTS',
          'DEEPGRAM_API_KEY=' + (keys.deepgramKey || ''),
          'ELEVENLABS_API_KEY=' + (keys.elevenLabsKey || ''),
          'GOOGLE_TTS_API_KEY=' + (keys.googleTtsKey || '')
        ].join('\n');

        fs.writeFileSync(backendEnv, envText, 'utf8');
        fs.writeFileSync(rootEnv, envText, 'utf8');

        // Update runtime process.env
        process.env.GEMINI_API_KEY = keys.geminiKey || '';
        process.env.NVIDIA_API_KEY = keys.nvidiaKey || '';
        process.env.OPENROUTER_API_KEY = keys.openRouterKey || '';

        const llmEngine = require('./services/llm-engine');
        llmEngine.refreshKeys();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'All platform keys saved and active!' }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }


  // API Route: Live LLM Diagnostic & Active Model Inspector
  if (req.method === 'GET' && parsedUrl === '/v1/llm/status') {
    const llm = require('./services/llm-engine');
    llm.refreshKeys();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      activeProvider: llm.activeProvider || 'Neural State Engine (Local Fallback)',
      activeModel: llm.openRouterKey ? 'meta-llama/llama-3.3-70b-instruct' : (llm.geminiKey ? 'gemini-1.5-flash' : 'vocalis-neural-engine'),
      geminiConfigured: !!llm.geminiKey,
      openRouterConfigured: !!llm.openRouterKey,
      nvidiaConfigured: !!llm.nvidiaKey,
      status: 'ONLINE'
    }));
    return;
  }


  // API Route: High-Fidelity Neural Speech Stream (Zero-Cost / 100% Free / All Languages)
  if (req.method === 'GET' && parsedUrl === '/v1/tts') {
    const queryParams = new URLSearchParams(req.url.split('?')[1] || '');
    const text = queryParams.get('text') || '';
    const lang = queryParams.get('lang') || 'en';
    if (!text) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'text parameter required' }));
      return;
    }

    const langCodeMap = {
      'ta': 'ta', 'kn': 'kn', 'te': 'te', 'hi': 'hi',
      'en-IN': 'en-IN', 'en-GB': 'en-GB', 'en-US': 'en-US',
      'ar': 'ar', 'fr': 'fr', 'en': 'en'
    };
    const tl = langCodeMap[lang] || 'en';
    const cleanText = text.replace(/[*_#`]/g, '').trim();
    const encoded = encodeURIComponent(cleanText.slice(0, 350));
    const url = 'https://translate.google.com/translate_tts?ie=UTF-8&tl=' + tl + '&client=tw-ob&q=' + encoded;

    const https = require('https');
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (tRes) => {
      if (tRes.statusCode === 200) {
        res.writeHead(200, {
          'Content-Type': 'audio/mpeg',
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*'
        });
        tRes.pipe(res);
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'TTS stream failed' }));
      }
    }).on('error', (e) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    });
    return;
  }

  // Static File Routing
  let filePath;
  if (parsedUrl.startsWith('/client-portal')) {
    let subPath = parsedUrl.replace('/client-portal', '');
    if (subPath === '' || subPath === '/') subPath = '/index.html';
    filePath = path.join(CLIENT_PORTAL_DIR, subPath);
  } else if (parsedUrl.startsWith('/admin')) {
    let subPath = parsedUrl.replace('/admin', '');
    if (subPath === '' || subPath === '/') subPath = '/index.html';
    filePath = path.join(ADMIN_DIR, subPath);
  } else {
    filePath = path.join(ADMIN_DIR, parsedUrl === '/' ? 'index.html' : parsedUrl);
  }

  const extname = path.extname(filePath);
  let contentType = MIME_TYPES[extname] || 'text/html';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 Not Found: ' + parsedUrl + '</h1>', 'utf-8');
      } else {
        res.writeHead(500);
        res.end('Internal Server Error: ' + error.code, 'utf-8');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
}

const server = http.createServer(requestHandler);

// Upgrade HTTP server to support WebSocket for Twilio Media Streams (Phase 5)
const { WebSocketServer } = require('ws');
// attachMediaStreamServer is called after server.listen below

if (require.main === module && !process.env.VERCEL) {
server.listen(PORT, () => {
  console.log(`\n===========================================================`);
  console.log(`Ã°Å¸Å¡â‚¬ Vocalis AI Production Server Live at http://localhost:${PORT}`);
  console.log(`Ã¢â‚¬Â¢ Admin Super-Panel: http://localhost:${PORT}/index.html`);
  console.log(`Ã¢â‚¬Â¢ Client Reception Portal: http://localhost:${PORT}/client-portal/index.html`);
  console.log(`Ã¢â‚¬Â¢ Inbound Telephony Webhook: POST http://localhost:${PORT}/v1/telephony/inbound`);
  console.log(`Ã¢â‚¬Â¢ Verified WhatsApp Dispatcher: POST http://localhost:${PORT}/v1/test/whatsapp`);
  console.log(`Ã¢â‚¬Â¢ Twilio Media Stream: wss://localhost:${PORT}/v1/stream`);
  console.log(`Ã¢â‚¬Â¢ Recording Callback: POST http://localhost:${PORT}/v1/telephony/recording`);
  console.log(`Ã¢â‚¬Â¢ Phase 5 Phone: ${process.env.TWILIO_PHONE_NUMBER || 'Not configured (add TWILIO_PHONE_NUMBER to .env)'}`);
  console.log(`===========================================================\n`);
  
  // Attach WebSocket server for Twilio Media Streams
  attachMediaStreamServer(server);
});
}


module.exports = requestHandler;



