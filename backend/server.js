require('dotenv').config({ path: __dirname + '/.env' });
const http = require('http');
const fs = require('fs');
const path = require('path');
const { handleInboundCall } = require('./routes/telephony');
const { handleChat } = require('./routes/chat');
const callRecorder = require('./services/call-recorder');
const tenantStore = require('./services/tenant-store');
const bookingEngine = require('./services/booking-engine');
const callLogsStore = require('./services/call-logs-store');
const outboundAutoCall = require('./services/outbound-autocall');
const WhatsAppDispatcher = require('./services/whatsapp-dispatcher');
const { configured } = require('./services/integrations');

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
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};
const BODY_SIZE_LIMIT = 100 * 1024;

function isProductionLock() {
  return !!(process.env.VERCEL || process.env.NODE_ENV === 'production');
}

function isAdminAuthorized(req) {
  const key = process.env.ADMIN_API_KEY;
  if (!key) return true; // Allows demo/trial onboarding without locking out users
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
    const waitMs = process.env.VERCEL ? 8000 : 250;
    setTimeout(() => done(body), waitMs);
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

  // Health check (Oracle uptime / tunnel verify)
  if (req.method === 'GET' && (parsedUrl === '/api/health' || parsedUrl === '/v1/health')) {
    const cfg = configured();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      uptimeSec: Math.round(process.uptime()),
      vercel: !!process.env.VERCEL,
      mediaStream: cfg.mediaStream,
      voiceWsUrl: cfg.voiceWsUrl,
      integrations: cfg
    }));
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
          clinicName: "Kumar's Microscopic Dental Care",
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


  if (req.method === 'GET' && parsedUrl === '/v1/admin/stats') {
    const tenants = tenantStore.getAllTenants();
    const bookings = bookingEngine.getAllBookings().filter((b) => !String(b.id || '').startsWith('BKG-880'));
    const logs = callLogsStore.getAllLogs().filter((l) => !String(l.id || '').startsWith('CAL-990'));
    const day = new Date().toISOString().slice(0, 10);
    const isToday = (iso) => String(iso || '').startsWith(day);
    const trials = tenants.filter((t) => t.status === 'trial' || t.plan === 'trial');
    const live = tenants.filter((t) => !t.suspended && t.status !== 'trial' && t.plan !== 'trial');
    const rule = {
      dental: 'WhatsApp on confirmed booking',
      realestate: 'WhatsApp on site visit',
      hvac: 'WhatsApp on dispatch',
      legal: 'WhatsApp on intake',
      restaurant: 'WhatsApp on reservation'
    };
    const market = (t) => {
      const map = {
        GBP: 'UK · GBP',
        INR: 'India · INR',
        USD: 'US · USD',
        AED: 'UAE / Dubai · AED',
        EUR: 'Eurozone · EUR',
        AUD: 'Australia · AUD',
        CAD: 'Canada · CAD'
      };
      return (map[t.currency] || (t.city || '—')) + (t.city ? ' · ' + t.city : '');
    };
    const byCurrency = {};
    tenants.forEach((t) => {
      const c = t.currency || 'other';
      byCurrency[c] = (byCurrency[c] || 0) + 1;
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      clients: tenants.length,
      live: live.length,
      trials: trials.length,
      mrr: 0,
      mrrNote: 'No Stripe yet. Plan fees are not billed.',
      integrations: configured(),
      callsToday: logs.filter((l) => isToday(l.timestamp)).length,
      callsAll: logs.length,
      bookingsToday: bookings.filter((b) => isToday(b.bookedAt)).length,
      bookingsAll: bookings.length,
      markets: byCurrency,
      clientsList: tenants.map((t) => ({
        id: t.id,
        name: t.businessName,
        market: market(t),
        rule: rule[t.industry] || 'WhatsApp on booking',
        status: t.suspended ? 'suspended' : (t.status === 'trial' || t.plan === 'trial' ? 'trial' : 'live'),
        calls: logs.filter((l) => l.tenantId === t.id).length,
        mrr: parseFloat(String(t.monthlyFee || '0').replace(/,/g, '')) || 0
      })),
      activities: [...bookings].reverse().slice(0, 8).map((b) => ({
        text: (b.clinicName || b.tenantId) + ': booked ' + (b.patientName || 'caller') + ' · ' + (b.slotTime || ''),
        time: b.bookedAt ? new Date(b.bookedAt).toLocaleString() : ''
      })),
      trialRows: trials.map((t) => ({
        id: t.id,
        name: t.businessName,
        market: market(t),
        daysLeft: t.trialDaysLeft != null ? t.trialDaysLeft : '—',
        calls: logs.filter((l) => l.tenantId === t.id).length
      }))
    }));
    return;
  }

  // API Route: Get All Tenants
  if (req.method === 'GET' && parsedUrl === '/v1/tenants') {
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

        if (process.env.VERCEL) {
          process.env.GEMINI_API_KEY = apiKey.trim();
          const llmEngine = require('./services/llm-engine');
          llmEngine.apiKey = apiKey.trim();
          llmEngine.available = true;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Gemini key set in process only (Vercel has no writable .env)' }));
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

        process.env.GEMINI_API_KEY = keys.geminiKey || process.env.GEMINI_API_KEY;
        process.env.NVIDIA_API_KEY = keys.nvidiaKey || process.env.NVIDIA_API_KEY;
        process.env.OPENROUTER_API_KEY = keys.openRouterKey || process.env.OPENROUTER_API_KEY;
        process.env.TWILIO_ACCOUNT_SID = keys.twilioSid || process.env.TWILIO_ACCOUNT_SID;
        process.env.TWILIO_AUTH_TOKEN = keys.twilioToken || process.env.TWILIO_AUTH_TOKEN;
        process.env.TWILIO_PHONE_NUMBER = keys.twilioPhone || process.env.TWILIO_PHONE_NUMBER;
        process.env.GUPSHUP_API_KEY = keys.gupshupKey || process.env.GUPSHUP_API_KEY;
        process.env.GUPSHUP_APP_NAME = keys.gupshupApp || process.env.GUPSHUP_APP_NAME;
        process.env.DEEPGRAM_API_KEY = keys.deepgramKey || process.env.DEEPGRAM_API_KEY;
        process.env.ELEVENLABS_API_KEY = keys.elevenLabsKey || process.env.ELEVENLABS_API_KEY;

        if (!process.env.VERCEL) {
          fs.writeFileSync(backendEnv, envText, 'utf8');
          fs.writeFileSync(rootEnv, envText, 'utf8');
        }

        const llmEngine = require('./services/llm-engine');
        llmEngine.refreshKeys();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: process.env.VERCEL ? 'Keys set in process only (no .env on Vercel)' : 'Keys saved to .env'
        }));
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

  if (req.method === 'GET' && parsedUrl === '/v1/integrations/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(configured()));
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

module.exports = requestHandler;

if (require.main === module && !process.env.VERCEL) {
  const { attachMediaStreamServer } = require('./routes/voice-stream');
  const server = http.createServer(requestHandler);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Vocalis listening http://0.0.0.0:${PORT}`);
    console.log('Admin: http://localhost:' + PORT + '/index.html');
    console.log('Demo: http://localhost:' + PORT + '/demo.html');
    console.log('Inbound TwiML: POST /v1/telephony/inbound');
    console.log('Media Stream WSS: /v1/stream');
    console.log('USE_MEDIA_STREAM=' + (process.env.USE_MEDIA_STREAM || 'false'));
    console.log('VOICE_WS_URL=' + (process.env.VOICE_WS_URL || '(derive from PUBLIC_BASE_URL)'));
    console.log('Phone: ' + (process.env.TWILIO_PHONE_NUMBER || 'not set'));
    attachMediaStreamServer(server);
  });
}



