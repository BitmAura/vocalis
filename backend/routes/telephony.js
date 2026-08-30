/**
 * Vocalis AI — Enterprise Inbound Telephony Engine
 * Handles live phone calls via Twilio with real-time Speech Recognition,
 * LLM Neural Dialogue, Appointment Booking & Dual-Channel Recording.
 */
const dialog = require('../services/dialog-engine');
const llm = require('../services/llm-engine');
const tenantStore = require('../services/tenant-store');
const bookingEngine = require('../services/booking-engine');
const emergencyGate = require('../services/emergency-gate');
const bookingLifecycle = require('../services/booking-lifecycle');
const { generateMediaStreamTwiML } = require('../routes/voice-stream');
const { appBaseUrl } = require('../services/integrations');

const callHistories = new Map(); // CallSid -> { history, tenant, lang, callerName }

const VOICE_MAP = {
  'en-GB': { voice: 'Google.en-GB-Neural2-F', lang: 'en-GB', prosodyRate: '1.03', prosodyPitch: '+1%' },
  'en-US': { voice: 'Google.en-US-Neural2-F', lang: 'en-US', prosodyRate: '1.02', prosodyPitch: '+0%' },
  'en-IN': { voice: 'Google.en-IN-Neural2-A', lang: 'en-IN', prosodyRate: '1.02', prosodyPitch: '+1%' },
  'kn':    { voice: 'Google.kn-IN-Wavenet-A', lang: 'kn-IN', prosodyRate: '1.02', prosodyPitch: '+0%' },
  'te':    { voice: 'Google.te-IN-Standard-A', lang: 'te-IN', prosodyRate: '1.02', prosodyPitch: '+0%' },
  'ta':    { voice: 'Google.ta-IN-Wavenet-A', lang: 'ta-IN', prosodyRate: '1.02', prosodyPitch: '+0%' },
  'hi':    { voice: 'Google.hi-IN-Neural2-D', lang: 'hi-IN', prosodyRate: '1.02', prosodyPitch: '+0%' },
  'ar':    { voice: 'Google.ar-XA-Wavenet-A', lang: 'ar-XA', prosodyRate: '1.00', prosodyPitch: '+0%' }
};

function useMediaStream() {
  if (process.env.VERCEL && !process.env.VOICE_WS_URL) return false;
  return process.env.USE_MEDIA_STREAM === 'true' || process.env.USE_MEDIA_STREAM === '1' || !!process.env.VOICE_WS_URL;
}

function resolveTenant(toNumber) {
  const tenants = tenantStore.getAllTenants();
  let tenant = tenants.find(t => t.phone && t.phone.replace(/\D/g,'') === String(toNumber || '').replace(/\D/g,''));
  if (!tenant) {
    const activeId = tenantStore.getActiveTestTenantId();
    tenant = tenantStore.getTenantById(activeId) || tenants[0];
  }
  if (!tenant) {
    tenant = {
      id: 'TNT-001',
      businessName: 'Harley Street Smiles Dental',
      ownerName: 'Dr. Harley',
      industry: 'dental',
      personaName: 'Clara',
      language: 'en-GB',
      doctorPhone: '+44 7911 123456'
    };
  }
  return tenant;
}

function twimlEmergency(vConfig, lang) {
  const msg = emergencyGate.emergencyResponse(lang);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${vConfig.voice}" language="${vConfig.lang}">${escapeXml(msg)}</Say>
  <Hangup />
</Response>`;
}

async function handleInboundCall(reqBody) {
  const fromNumber = reqBody.From || '+Unknown';
  const toNumber = reqBody.To || '+19803723727';
  const callSid = reqBody.CallSid || 'CA_' + Date.now();
  const speechResult = reqBody.SpeechResult || reqBody.speechResult || null;

  const tenant = resolveTenant(toNumber);

  let session = callHistories.get(callSid);
  if (!session) {
    session = {
      history: [],
      tenant,
      lang: tenant.language || 'en-GB',
      callerName: '',
      from: fromNumber,
      pendingAction: null,
      pendingBookingId: null
    };
    callHistories.set(callSid, session);
    console.log(`\n📞 [Incoming Phone Call] CallSid: ${callSid} | From: ${fromNumber} | Business: ${tenant.businessName}`);
  }

  const vConfig = VOICE_MAP[session.lang] || VOICE_MAP['en-GB'];

  // TURN 1: Initial — optionally route to Media Stream (Oracle / realtime voice)
  if (!speechResult) {
    if (useMediaStream()) {
      console.log('[Telephony] Routing to Media Stream (USE_MEDIA_STREAM / VOICE_WS_URL)');
      return generateMediaStreamTwiML({
        tenantId: tenant.id,
        industry: tenant.industry,
        language: session.lang,
        bizName: tenant.businessName,
        ownerName: tenant.ownerName,
        personaName: tenant.personaName || 'Clara',
        city: tenant.city || 'Central London',
        doctorPhone: tenant.doctorWhatsApp || tenant.doctorPhone || '',
        callerPhone: fromNumber,
        toNumber: toNumber
      });
    }

    const greeting = tenant.industry === 'realestate'
      ? (session.lang === 'kn'
        ? 'Namaskara! Prestige Managed Farmland ge swagata. Naanu Priya — hege help maadli?'
        : 'Hello! Thank you for calling Prestige Managed Farmlands. My name is Priya, how can I help you today?')
      : (['hi', 'en-IN'].includes(session.lang)
        ? `Namaste! ${tenant.businessName} mein call karne ke liye dhanyavaad. Main ${tenant.personaName || 'Clara'} hoon. Kya aap appointment book karna chahenge?`
        : `Good afternoon! Thank you for calling ${tenant.businessName}. My name is ${tenant.personaName || 'Clara'}. Are you looking to book an appointment today?`);

    session.history.push({ role: 'ai', text: greeting });
    return twimlSayGather(vConfig, greeting);
  }

  // Medical emergency — deterministic gate BEFORE LLM
  if (emergencyGate.isMedicalEmergency(speechResult)) {
    console.log(`🚨 [Medical Emergency Detected] CallSid: ${callSid} | Caller: ${fromNumber}`);
    session.history.push({ role: 'user', text: speechResult });
    session.history.push({ role: 'ai', text: emergencyGate.emergencyResponse(session.lang) });
    callHistories.delete(callSid);
    return twimlEmergency(VOICE_MAP[session.lang] || vConfig, session.lang);
  }

  // SUBSEQUENT TURNS: Process Caller Speech
  console.log(`👤 Caller (${fromNumber}): "${speechResult}"`);
  session.history.push({ role: 'user', text: speechResult });

  const detectedLang = dialog.resolveLanguage(speechResult, session.lang);
  session.lang = detectedLang;
  const turnVConfig = VOICE_MAP[session.lang] || VOICE_MAP['en-GB'];

  const extractedName = dialog.extractCallerName(speechResult, session.history);
  if (extractedName && !session.callerName) session.callerName = extractedName;

  const requestedSlot = dialog.parseRequestedSlot(speechResult, session.history);

  // Cancel / reschedule — before LLM
  const lifecycle = await bookingLifecycle.processBookingLifecycle({
    message: speechResult,
    lang: session.lang,
    tenantId: session.tenant.id,
    patientPhone: fromNumber,
    clinicName: session.tenant.businessName,
    doctorPhone: session.tenant.doctorWhatsApp || session.tenant.doctorPhone,
    requestedSlot,
    history: session.history,
    session
  });

  if (lifecycle.handled) {
    console.log(`📋 [Booking lifecycle] ${lifecycle.action}: "${lifecycle.reply}"`);
    session.history.push({ role: 'ai', text: lifecycle.reply });
    if (lifecycle.hangup) {
      callHistories.delete(callSid);
      return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${turnVConfig.voice}" language="${turnVConfig.lang}">${escapeXml(lifecycle.reply)}</Say>
  <Hangup />
</Response>`;
    }
    return twimlSayGather(turnVConfig, lifecycle.reply);
  }

  // Generate LLM Reply
  const llmRes = await llm.chat(speechResult, {
    tenantId: session.tenant.id,
    language: session.lang,
    industry: session.tenant.industry,
    bizName: session.tenant.businessName,
    ownerName: session.tenant.ownerName,
    city: session.tenant.city || 'Central London',
    address: session.tenant.address || '14 Harley Street, London',
    workingHours: session.tenant.workingHours || 'Mon-Sat: 8:30 AM - 6:00 PM',
    personaName: session.tenant.personaName || 'Clara',
    services: session.tenant.services || [],
    requestedSlot,
    callerName: session.callerName
  }, session.history);

  const reply = llmRes.reply || "Certainly, I have noted that down for you.";
  console.log(`🤖 AI (${session.tenant.businessName}): "${reply}"`);
  session.history.push({ role: 'ai', text: reply });

  // Backup: LLM confirmed cancel/reschedule in natural language
  const llmAction = await bookingLifecycle.executeFromLlmReply({
    reply,
    lang: session.lang,
    tenantId: session.tenant.id,
    patientPhone: fromNumber,
    clinicName: session.tenant.businessName,
    doctorPhone: session.tenant.doctorWhatsApp || session.tenant.doctorPhone,
    requestedSlot
  });
  if (llmAction.executed && (llmAction.action === 'cancelled' || llmAction.action === 'rescheduled')) {
    callHistories.delete(callSid);
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${turnVConfig.voice}" language="${turnVConfig.lang}">${escapeXml(reply)}</Say>
  <Hangup />
</Response>`;
  }

  const isConfirmed = dialog.isConfirmedBookingReply(reply);

  // Trigger Booking & SMS/WhatsApp Notification if Confirmed
  if (isConfirmed) {
    const finalName = session.callerName || extractedName || 'Caller';
    const finalSlot = requestedSlot || 'Tomorrow at 12:30 PM';

    console.log(`🎉 [Booking Confirmed via Phone Call] ${finalName} @ ${finalSlot}`);

    try {
      await bookingEngine.createBooking({
        tenantId: session.tenant.id,
        clinicName: session.tenant.businessName,
        patientName: finalName,
        patientPhone: fromNumber,
        treatment: session.tenant.industry === 'realestate' ? 'Weekend Farmland Site Visit' : 'Consultation',
        slotTime: finalSlot,
        doctorName: session.tenant.ownerName || 'Dr. Harley',
        doctorPhone: session.tenant.doctorWhatsApp || session.tenant.doctorPhone || '+919845012345',
        transcript: session.history
      });
    } catch(e) {
      console.error('[Booking Save Error]:', e.message);
    }

    callHistories.delete(callSid);
    const farewellClosing = reply + ' I have sent an SMS confirmation to your mobile. Thank you for calling ' + session.tenant.businessName + '. Have a wonderful day! Goodbye.';
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${turnVConfig.voice}" language="${turnVConfig.lang}">${escapeXml(farewellClosing)}</Say>
  <Hangup />
</Response>`;
  }

  // Check if farewell / closing
  const low = speechResult.toLowerCase();
  const isFarewell = low.includes('bye') || low.includes('thank you, goodbye') || low.includes('dhanyavaad') || low.includes('thanks bye');

  if (isFarewell) {
    callHistories.delete(callSid);
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${turnVConfig.voice}" language="${turnVConfig.lang}">${escapeXml(reply)}</Say>
  <Hangup />
</Response>`;
  }

  return twimlSayGather(turnVConfig, reply);
}

function inboundActionUrl() {
  const base = (appBaseUrl() || '').replace(/\/$/, '');
  return (base || '') + '/v1/telephony/inbound';
}

function twimlSayGather(vConfig, text) {
  const action = inboundActionUrl();
  const rate = vConfig.prosodyRate || '1.02';
  const pitch = vConfig.prosodyPitch || '+0%';
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${escapeXml(action)}" method="POST" speechTimeout="auto" speechModel="phone_call" enhanced="true" language="${vConfig.lang}" bargeIn="true">
    <Say voice="${vConfig.voice}" language="${vConfig.lang}"><prosody rate="${rate}" pitch="${pitch}">${escapeXml(text)}</prosody></Say>
  </Gather>
  <Gather input="speech" action="${escapeXml(action)}" method="POST" speechTimeout="auto" speechModel="phone_call" enhanced="true" language="${vConfig.lang}" bargeIn="true">
    <Say voice="${vConfig.voice}" language="${vConfig.lang}"><prosody rate="${rate}">I am still with you! Are you looking to book an appointment?</prosody></Say>
  </Gather>
  <Hangup />
</Response>`;
}

function escapeXml(unsafe) {
  if (!unsafe) return '';
  return unsafe.replace(/[<>&'"]/g, function (c) {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

module.exports = { handleInboundCall, useMediaStream };
