/**
 * Vocalis — Twilio Media Streams (smooth realtime voice on Oracle).
 * Audio: mulaw 8kHz in/out. STT: Deepgram. TTS: Google mulaw / IndicF5 WAV.
 */
const WebSocket = require('ws');
const llmEngine = require('../services/llm-engine');
const sttEngine = require('../services/stt-engine');
const ttsEngine = require('../services/tts-engine');
const bookingEngine = require('../services/booking-engine');
const bookingLifecycle = require('../services/booking-lifecycle');
const tenantStore = require('../services/tenant-store');
const dialog = require('../services/dialog-engine');
const emergencyGate = require('../services/emergency-gate');
const { sendMulawStream, mulawEnergy } = require('../services/twilio-audio');

const activeSessions = new Map();

const CHUNK_MS = 20;
const CHUNKS_PER_SEC = 1000 / CHUNK_MS;
const MIN_SPEECH_CHUNKS = Math.floor(0.4 * CHUNKS_PER_SEC); // 400ms min speech
const SILENCE_CHUNKS = Math.floor(0.55 * CHUNKS_PER_SEC); // 550ms silence ends turn
const MAX_BUFFER_CHUNKS = Math.floor(12 * CHUNKS_PER_SEC);

class CallSession {
  constructor(streamSid, callSid, tenantConfig, callerPhone) {
    this.streamSid = streamSid;
    this.callSid = callSid;
    this.tenant = tenantConfig;
    this.callerPhone = callerPhone || '';
    this.history = [];
    this.audioBuffer = [];
    this.speechChunks = 0;
    this.silenceChunks = 0;
    this.isSpeaking = false;
    this.isProcessing = false;
    this.failedTurns = 0;
    this.MAX_FAILED_TURNS = 3;
    this.callerName = '';
    this.pendingAction = null;
    this.pendingBookingId = null;
    this.startTime = new Date();
    console.log(`[Voice Stream] Call ${callSid} | ${tenantConfig.bizName} | ${callerPhone}`);
  }

  greetingText() {
    const t = this.tenant;
    if (t.industry === 'realestate') {
      return this.tenant.language === 'kn'
        ? 'Namaskara! Prestige Managed Farmland ge swagata. Naanu Priya — hege help maadli?'
        : 'Hello! Thank you for calling Prestige Managed Farmlands. My name is Priya, how can I help you?';
    }
    if (['hi', 'en-IN'].includes(t.language)) {
      return `Namaste! ${t.bizName} mein call karne ke liye dhanyavaad. Main ${t.personaName || 'Clara'} hoon. Kya aap appointment book, cancel ya reschedule karna chahenge?`;
    }
    return `Good afternoon! Thank you for calling ${t.bizName}. My name is ${t.personaName || 'Clara'}. Would you like to book, cancel, or reschedule an appointment?`;
  }

  async speakReply(ws, reply, lang) {
    if (!reply) return;
    try {
      const mulaw = await ttsEngine.synthesizeMulaw8k(reply, lang || this.tenant.language);
      if (mulaw && mulaw.length > 160) {
        this.isSpeaking = true;
        this.interruptEnergyCount = 0;
        sendMulawStream(ws, this.streamSid, mulaw, { clearFirst: true });
        const durationMs = Math.ceil(mulaw.length / 160) * 20;
        setTimeout(() => { 
          if (this.isSpeaking) this.isSpeaking = false; 
        }, Math.min(15000, durationMs + 150));
      }
    } catch(err) {
      console.error('[Voice Stream speakReply error]:', err.message);
      this.isSpeaking = false;
    }
  }

  async handleTranscript(ws, transcript) {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      if (!transcript || transcript.trim().length < 2) {
        this.failedTurns++;
        if (this.failedTurns >= this.MAX_FAILED_TURNS) {
          ws.send(JSON.stringify({ event: 'stop', streamSid: this.streamSid }));
          return;
        }
        await this.speakReply(ws, "Sorry, I didn't catch that. Could you say it again?", this.tenant.language);
        return;
      }

      this.failedTurns = 0;
      const lang = dialog.resolveLanguage(transcript, this.tenant.language);
      this.tenant.language = lang;
      this.history.push({ role: 'user', text: transcript });

      const requestedSlot = dialog.parseRequestedSlot(transcript, this.history);
      const name = dialog.extractCallerName(transcript, this.history);
      if (name) this.callerName = name;

      const lifecycle = await bookingLifecycle.processBookingLifecycle({
        message: transcript,
        lang,
        tenantId: this.tenant.tenantId,
        patientPhone: this.callerPhone,
        clinicName: this.tenant.bizName,
        doctorPhone: this.tenant.doctorPhone,
        requestedSlot,
        history: this.history,
        session: this
      });

      if (lifecycle.handled) {
        this.history.push({ role: 'ai', text: lifecycle.reply });
        await this.speakReply(ws, lifecycle.reply, lang);
        if (lifecycle.hangup) {
          setTimeout(() => ws.send(JSON.stringify({ event: 'stop', streamSid: this.streamSid })), 1200);
        }
        return;
      }

      if (emergencyGate.isMedicalEmergency(transcript)) {
        const msg = emergencyGate.emergencyResponse(lang);
        this.history.push({ role: 'ai', text: msg });
        await this.speakReply(ws, msg, lang);
        setTimeout(() => ws.send(JSON.stringify({ event: 'stop', streamSid: this.streamSid })), 2000);
        return;
      }

      const llmResult = await llmEngine.chat(transcript, {
        tenantId: this.tenant.tenantId,
        language: lang,
        industry: this.tenant.industry,
        bizName: this.tenant.bizName,
        ownerName: this.tenant.ownerName,
        city: this.tenant.city,
        address: this.tenant.address,
        workingHours: this.tenant.workingHours,
        personaName: this.tenant.personaName,
        requestedSlot,
        callerName: this.callerName
      }, this.history);

      const fallback = dialog.processTurn({
        message: transcript,
        language: lang,
        industry: this.tenant.industry,
        personaName: this.tenant.personaName,
        bizName: this.tenant.bizName,
        ownerName: this.tenant.ownerName,
        history: this.history.slice(0, -1),
        requestedSlot,
        callerName: this.callerName
      });

      const reply = llmResult.reply || fallback.reply;
      this.history.push({ role: 'ai', text: reply });

      await bookingLifecycle.executeFromLlmReply({
        reply,
        lang,
        tenantId: this.tenant.tenantId,
        patientPhone: this.callerPhone,
        clinicName: this.tenant.bizName,
        doctorPhone: this.tenant.doctorPhone,
        requestedSlot: requestedSlot || fallback.requestedSlot
      });

      if (dialog.isConfirmedBookingReply(reply)) {
        const finalName = this.callerName || fallback.callerName || 'Caller';
        const finalSlot = requestedSlot || fallback.requestedSlot || 'Tomorrow at 12:30 PM';
        await bookingEngine.createBooking({
          tenantId: this.tenant.tenantId,
          clinicName: this.tenant.bizName,
          patientName: finalName,
          patientPhone: this.callerPhone,
          treatment: 'Consultation',
          slotTime: finalSlot,
          doctorName: this.tenant.ownerName,
          doctorPhone: this.tenant.doctorPhone,
          transcript: this.history,
          language: lang
        });
      }

      await this.speakReply(ws, reply, lang);
    } finally {
      this.isProcessing = false;
    }
  }
}

function resolveTenantFromParams(params, toNumber) {
  const tenants = tenantStore.getAllTenants();
  let tenant = tenants.find((t) => params.tenantId && t.id === params.tenantId);
  if (!tenant && toNumber) {
    tenant = tenants.find((t) => t.phone && t.phone.replace(/\D/g, '') === String(toNumber).replace(/\D/g, ''));
  }
  if (!tenant) {
    tenant = tenantStore.getTenantById(tenantStore.getActiveTestTenantId()) || tenants[0];
  }
  if (!tenant) {
    return {
      tenantId: 'TNT-001',
      industry: 'dental',
      language: params.language || 'en-IN',
      bizName: params.bizName || 'Clinic',
      ownerName: params.ownerName || 'Doctor',
      personaName: params.personaName || 'Clara',
      city: params.city || 'India',
      address: '',
      workingHours: '',
      doctorPhone: params.doctorPhone || process.env.DEFAULT_DOCTOR_PHONE || ''
    };
  }
  return {
    tenantId: tenant.id,
    industry: tenant.industry || params.industry || 'dental',
    language: params.language || tenant.language || 'en-IN',
    bizName: params.bizName || tenant.businessName,
    ownerName: params.ownerName || tenant.ownerName,
    personaName: params.personaName || tenant.personaName || 'Clara',
    city: params.city || tenant.city || 'India',
    address: tenant.address || '',
    workingHours: tenant.workingHours || '',
    doctorPhone: params.doctorPhone || tenant.doctorWhatsApp || tenant.doctorPhone || ''
  };
}

function attachMediaStreamServer(httpServer) {
  const wss = new WebSocket.Server({ server: httpServer, path: '/v1/stream' });
  console.log('[Voice Stream] WebSocket ready at /v1/stream (mulaw 8kHz)');

  wss.on('connection', (ws) => {
    let session = null;

    ws.on('message', async (message) => {
      let data;
      try { data = JSON.parse(message); } catch (e) { return; }

      switch (data.event) {
        case 'connected':
          console.log('[Voice Stream] Twilio connected');
          break;

        case 'start': {
          const streamSid = data.streamSid;
          const callSid = data.start && data.start.callSid;
          const params = (data.start && data.start.customParameters) || {};
          const callerPhone = params.callerPhone || params.from || '';
          const tenantConfig = resolveTenantFromParams(params, params.toNumber || '');

          session = new CallSession(streamSid, callSid, tenantConfig, callerPhone);
          activeSessions.set(streamSid, session);

          const greeting = session.greetingText();
          session.history.push({ role: 'ai', text: greeting });
          await session.speakReply(ws, greeting, tenantConfig.language);
          break;
        }

        case 'media': {
          if (!session) break;

          const chunk = Buffer.from(data.media.payload, 'base64');
          const energy = mulawEnergy(chunk);
          const isVoice = energy > 8;

          // ⚡ FULL DUPLEX BARGE-IN: If caller speaks while AI is speaking, cut audio instantly
          if (session.isSpeaking && isVoice) {
            session.interruptEnergyCount = (session.interruptEnergyCount || 0) + 1;
            if (session.interruptEnergyCount >= 3) {
              console.log('[Voice Stream] ⚡ Caller Barge-In detected — cutting AI audio playback');
              session.isSpeaking = false;
              session.interruptEnergyCount = 0;
              try {
                ws.send(JSON.stringify({ event: 'clear', streamSid: session.streamSid }));
              } catch(e) {}
            }
          } else {
            session.interruptEnergyCount = 0;
          }

          if (session.isSpeaking || session.isProcessing) break;

          session.audioBuffer.push(chunk);

          if (isVoice) {
            session.speechChunks++;
            session.silenceChunks = 0;
          } else if (session.speechChunks > 0) {
            session.silenceChunks++;
          }

          if (session.audioBuffer.length > MAX_BUFFER_CHUNKS) {
            session.audioBuffer = session.audioBuffer.slice(-MAX_BUFFER_CHUNKS);
          }

          const endOfUtterance =
            session.speechChunks >= MIN_SPEECH_CHUNKS &&
            session.silenceChunks >= SILENCE_CHUNKS;

          if (!endOfUtterance) break;

          const audioData = Buffer.concat(session.audioBuffer);
          session.audioBuffer = [];
          session.speechChunks = 0;
          session.silenceChunks = 0;

          const sttResult = await sttEngine.transcribe(audioData, session.tenant.language);
          if (sttResult.transcript && (sttResult.confidence || 0) > 0.45) {
            console.log(`[STT] "${sttResult.transcript}" (${(sttResult.confidence || 0).toFixed(2)})`);
            await session.handleTranscript(ws, sttResult.transcript);
          }
          break;
        }

        case 'stop':
          if (session) {
            const sec = Math.round((Date.now() - session.startTime) / 1000);
            console.log(`[Voice Stream] Ended ${session.callSid} (${sec}s)`);
            activeSessions.delete(session.streamSid);
          }
          break;

        default:
          break;
      }
    });

    ws.on('close', () => {
      if (session) activeSessions.delete(session.streamSid);
    });

    ws.on('error', (err) => console.error('[Voice Stream] WS error:', err.message));
  });

  return wss;
}

function generateMediaStreamTwiML(config) {
  const params = Object.entries({
    tenantId: config.tenantId || '',
    industry: config.industry || 'dental',
    language: config.language || 'en-IN',
    bizName: config.bizName || 'Clinic',
    ownerName: config.ownerName || 'Doctor',
    personaName: config.personaName || 'Clara',
    city: config.city || 'India',
    doctorPhone: config.doctorPhone || '',
    callerPhone: config.callerPhone || '',
    toNumber: config.toNumber || ''
  }).map(([k, v]) => `<Parameter name="${k}" value="${String(v).replace(/"/g, '&quot;')}"/>`).join('');

  const wsUrl = (process.env.VOICE_WS_URL || '').replace(/\/$/, '');
  const publicHttp = (require('../services/integrations').appBaseUrl() || '').replace(/\/$/, '');
  let serverUrl = wsUrl || publicHttp.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');

  if (!serverUrl || serverUrl.includes('your-server')) {
    console.error('[Voice Stream] Set VOICE_WS_URL or PUBLIC_BASE_URL to a public https URL');
  }

  let finalStreamUrl = serverUrl;
  if (!finalStreamUrl.endsWith('/v1/stream')) {
    finalStreamUrl = finalStreamUrl + '/v1/stream';
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${finalStreamUrl}">
      ${params}
    </Stream>
  </Connect>
</Response>`;
}

module.exports = { attachMediaStreamServer, generateMediaStreamTwiML, activeSessions };

