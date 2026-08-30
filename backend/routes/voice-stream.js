/**
 * Vocalis AI â€” Phase 5: Twilio Media Streams WebSocket Handler
 * 
 * Flow:
 * 1. Inbound call arrives at Twilio number
 * 2. Twilio sends TwiML: <Connect><Stream url="wss://your-server/v1/stream"/> </Connect>
 * 3. This WebSocket handler receives real-time mulaw audio chunks
 * 4. Audio chunks are buffered and sent to Deepgram STT
 * 5. Transcript goes to LLM engine (Gemini)
 * 6. LLM reply goes to TTS engine (ElevenLabs / Google Cloud)
 * 7. MP3 audio streamed back to caller via Twilio
 * 
 * Fallback: If 3 consecutive turns fail, forward to human using *71
 */

const WebSocket = require('ws');
const llmEngine = require('../services/llm-engine');
const sttEngine = require('../services/stt-engine');
const ttsEngine = require('../services/tts-engine');
const WhatsAppDispatcher = require('../services/whatsapp-dispatcher');
const dialog = require('../services/dialog-engine');
const emergencyGate = require('../services/emergency-gate');

// Active call sessions: streamSid -> session state
const activeSessions = new Map();

class CallSession {
  constructor(streamSid, callSid, tenantConfig) {
    this.streamSid = streamSid;
    this.callSid = callSid;
    this.tenant = tenantConfig || {
      industry: 'dental',
      language: 'en-GB',
      bizName: 'Harley Street Smiles Dental',
      ownerName: 'Dr. Harley',
      personaName: 'Clara',
      city: 'London',
      doctorPhone: process.env.DEFAULT_DOCTOR_PHONE || '+44 7911 123456'
    };
    this.history = [];
    this.audioBuffer = [];
    this.failedTurns = 0;
    this.MAX_FAILED_TURNS = 3;
    this.isGreetingPlayed = false;
    this.whatsApp = new WhatsAppDispatcher();
    this.callerName = '';
    this.callerPhone = '';
    this.bookingConfirmed = false;
    this.startTime = new Date();

    console.log(`[Call Session] New call ${callSid} | Industry: ${this.tenant.industry} | Lang: ${this.tenant.language}`);
  }

  async getGreeting() {
    return dialog.processTurn({
      message: 'hello',
      language: this.tenant.language,
      industry: this.tenant.industry,
      personaName: this.tenant.personaName,
      bizName: this.tenant.bizName,
      ownerName: this.tenant.ownerName,
      history: []
    }).reply;
  }

  async processTranscript(transcript) {
    if (!transcript || transcript.trim().length < 2) {
      this.failedTurns++;
      if (this.failedTurns >= this.MAX_FAILED_TURNS) {
        return { reply: null, action: 'forward' };
      }
      return { reply: "I'm sorry, I didn't quite catch that. Could you say that again?", action: 'speak' };
    }

    if (emergencyGate.isMedicalEmergency(transcript)) {
      const lang = dialog.resolveLanguage(transcript, this.tenant.language);
      const msg = emergencyGate.emergencyResponse(lang);
      this.history.push({ role: 'user', text: transcript });
      this.history.push({ role: 'ai', text: msg });
      return { reply: msg, action: 'hangup', language: lang };
    }

    this.failedTurns = 0;
    const lang = dialog.resolveLanguage(transcript, this.tenant.language);
    this.tenant.language = lang;
    this.history.push({ role: 'user', text: transcript });

    const llmResult = await llmEngine.chat(transcript, { ...this.tenant, language: lang }, this.history);
    const fallback = dialog.processTurn({
      message: transcript,
      language: lang,
      industry: this.tenant.industry,
      personaName: this.tenant.personaName,
      bizName: this.tenant.bizName,
      ownerName: this.tenant.ownerName,
      history: this.history.slice(0, -1)
    });
    const reply = llmResult.reply || fallback.reply;
    this.history.push({ role: 'ai', text: reply });

    if (!this.bookingConfirmed && dialog.isConfirmedBookingReply(reply) && fallback.callerName) {
      this.bookingConfirmed = true;
      this.callerName = fallback.callerName;
      this._triggerWhatsAppAlert(reply);
    }

    return { reply, action: 'speak', language: lang };
  }

  async _triggerWhatsAppAlert(aiReply) {
    try {
      const script = this.history.map(t => `${t.role === 'user' ? 'ðŸ‘¤' : 'ðŸ¤–'}: ${t.text}`).join('\n');
      await this.whatsApp.sendConfirmedBookingAlert(this.tenant.doctorPhone, {
        patientName: this.callerName || 'New Patient',
        patientPhone: this.callerPhone || 'Via Phone',
        treatment: 'Appointment via AI Receptionist',
        treatmentFee: 'TBD',
        slotTime: 'As confirmed in conversation',
        clinicName: this.tenant.bizName,
        conversationScript: script,
        audioUrl: `https://app.vocalis.ai/recordings/${this.callSid}.mp3`
      });
      console.log(`[Call Session] WhatsApp alert sent for call ${this.callSid}`);
    } catch(e) {
      console.error('[Call Session] WhatsApp alert failed:', e.message);
    }
  }
}

/**
 * Attaches Twilio Media Streams WebSocket server to existing HTTP server
 */
function attachMediaStreamServer(httpServer) {
  const wss = new WebSocket.Server({ 
    server: httpServer,
    path: '/v1/stream'
  });

  console.log('[Voice Stream] WebSocket server attached at /v1/stream');

  wss.on('connection', (ws, req) => {
    let session = null;

    ws.on('message', async (message) => {
      let data;
      try { data = JSON.parse(message); } catch(e) { return; }

      switch(data.event) {
        case 'connected':
          console.log('[Voice Stream] Twilio connected â€” ready for media');
          break;

        case 'start': {
          const streamSid = data.streamSid;
          const callSid = data.start?.callSid;
          
          // Load tenant config from call metadata (passed via TwiML params)
          const tenantConfig = {
            industry: data.start?.customParameters?.industry || 'dental',
            language: data.start?.customParameters?.language || 'en-GB',
            bizName: data.start?.customParameters?.bizName || 'Harley Street Smiles Dental',
            ownerName: data.start?.customParameters?.ownerName || 'Dr. Harley',
            personaName: data.start?.customParameters?.personaName || 'Clara',
            city: data.start?.customParameters?.city || 'London',
            doctorPhone: data.start?.customParameters?.doctorPhone || process.env.DEFAULT_DOCTOR_PHONE
          };

          session = new CallSession(streamSid, callSid, tenantConfig);
          activeSessions.set(streamSid, session);

          // Play greeting
          const greeting = await session.getGreeting();
          const audioBuffer = await ttsEngine.synthesize(greeting, tenantConfig.language);
          
          if (audioBuffer) {
            // Send audio back to Twilio via Media message
            const audioBase64 = audioBuffer.toString('base64');
            ws.send(JSON.stringify({
              event: 'media',
              streamSid,
              media: { payload: audioBase64 }
            }));
          }
          break;
        }

        case 'media': {
          if (!session) break;
          // Accumulate audio chunks (Twilio sends 20ms mulaw chunks)
          const audioChunk = Buffer.from(data.media.payload, 'base64');
          session.audioBuffer.push(audioChunk);

          // Process every ~1.5 seconds of audio (75 chunks @ 20ms each)
          if (session.audioBuffer.length >= 75) {
            const audioData = Buffer.concat(session.audioBuffer);
            session.audioBuffer = [];

            const sttResult = await sttEngine.transcribe(audioData, session.tenant.language);
            
            if (sttResult.transcript && sttResult.confidence > 0.6) {
              console.log(`[STT] "${sttResult.transcript}" (confidence: ${sttResult.confidence.toFixed(2)})`);
              
              const { reply, action } = await session.processTranscript(sttResult.transcript);
              
              if (action === 'forward') {
                ws.send(JSON.stringify({ event: 'stop', streamSid: session.streamSid }));
                console.log(`[Call Session] Forwarding call ${session.callSid} to human`);
              } else if (action === 'hangup') {
                if (reply) {
                  const audioBuffer = await ttsEngine.synthesize(reply, session.tenant.language);
                  if (audioBuffer) {
                    ws.send(JSON.stringify({
                      event: 'media',
                      streamSid: session.streamSid,
                      media: { payload: audioBuffer.toString('base64') }
                    }));
                  }
                }
                ws.send(JSON.stringify({ event: 'stop', streamSid: session.streamSid }));
              } else if (reply) {
                const audioBuffer = await ttsEngine.synthesize(reply, session.tenant.language);
                if (audioBuffer) {
                  ws.send(JSON.stringify({
                    event: 'media',
                    streamSid: session.streamSid,
                    media: { payload: audioBuffer.toString('base64') }
                  }));
                }
              }
            }
          }
          break;
        }

        case 'stop': {
          if (session) {
            console.log(`[Call Session] Call ended: ${session.callSid} | Duration: ${Math.round((Date.now() - session.startTime) / 1000)}s`);
            activeSessions.delete(session.streamSid);
          }
          break;
        }
      }
    });

    ws.on('close', () => {
      if (session) activeSessions.delete(session.streamSid);
    });

    ws.on('error', (err) => {
      console.error('[Voice Stream] WebSocket error:', err.message);
    });
  });

  return wss;
}

/**
 * Generates TwiML for Twilio inbound call to start Media Stream
 */
function generateMediaStreamTwiML(config) {
  const language = config.language || 'en-GB';
  const twimlVoice = ttsEngine.getTwimlVoice(language);
  
  // Build custom parameters for the WebSocket (tenant config)
  const params = Object.entries({
    industry: config.industry || 'dental',
    language,
    bizName: config.bizName || 'Harley Street Smiles Dental',
    ownerName: config.ownerName || 'Dr. Harley',
    personaName: config.personaName || 'Clara',
    city: config.city || 'London',
    doctorPhone: config.doctorPhone || ''
  }).map(([k, v]) => `<Parameter name="${k}" value="${v}"/>`).join('');

  const wsUrl = (process.env.VOICE_WS_URL || '').replace(/\/$/, '');
  const publicHttp = (require('../services/integrations').appBaseUrl() || process.env.PUBLIC_SERVER_URL || '').replace(/\/$/, '');
  const serverUrl = wsUrl || publicHttp.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:') || 'wss://your-server.com';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${serverUrl}/v1/stream">
      ${params}
    </Stream>
  </Connect>
</Response>`;
}

module.exports = { attachMediaStreamServer, generateMediaStreamTwiML, activeSessions };

