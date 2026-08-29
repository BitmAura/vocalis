/**
 * Vocalis AI — Enterprise Inbound Telephony Engine
 * Handles live phone calls via Twilio with real-time Speech Recognition,
 * LLM Neural Dialogue, Appointment Booking & Dual-Channel Recording.
 */
const dialog = require('../services/dialog-engine');
const llm = require('../services/llm-engine');
const tenantStore = require('../services/tenant-store');
const bookingEngine = require('../services/booking-engine');

const callHistories = new Map(); // CallSid -> { history, tenant, lang, callerName }

const VOICE_MAP = {
  'en-GB': { voice: 'Google.en-GB-Neural2-C', lang: 'en-GB' },
  'en-US': { voice: 'Google.en-US-Neural2-H', lang: 'en-US' },
  'kn':    { voice: 'Google.kn-IN-Wavenet-A', lang: 'kn-IN' },
  'te':    { voice: 'Google.te-IN-Standard-A', lang: 'te-IN' },
  'ta':    { voice: 'Google.ta-IN-Wavenet-A', lang: 'ta-IN' },
  'hi':    { voice: 'Google.hi-IN-Wavenet-A', lang: 'hi-IN' },
  'ar':    { voice: 'Google.ar-XA-Wavenet-A', lang: 'ar-XA' }
};

async function handleInboundCall(reqBody) {
  const fromNumber = reqBody.From || '+Unknown';
  const toNumber = reqBody.To || '+19803723727';
  const callSid = reqBody.CallSid || 'CA_' + Date.now();
  const speechResult = reqBody.SpeechResult || reqBody.speechResult || null;

  // Resolve tenant: 1. By direct matched phone number, 2. By active test routing from Admin Dashboard
  const tenants = tenantStore.getAllTenants();
  let tenant = tenants.find(t => t.phone && t.phone.replace(/\D/g,'') === toNumber.replace(/\D/g,''));
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

  let session = callHistories.get(callSid);
  if (!session) {
    session = {
      history: [],
      tenant,
      lang: tenant.language || 'en-GB',
      callerName: '',
      from: fromNumber
    };
    callHistories.set(callSid, session);
    console.log(`\n📞 [Incoming Phone Call] CallSid: ${callSid} | From: ${fromNumber} | Business: ${tenant.businessName}`);
  }

  const vConfig = VOICE_MAP[session.lang] || VOICE_MAP['en-GB'];

  // TURN 1: Initial Greeting
  if (!speechResult) {
    const greeting = tenant.industry === 'realestate'
      ? (session.lang === 'kn' ? 'ನಮಸ್ಕಾರ! ಪ್ರೆಸ್ಟೀಜ್ ಮ್ಯಾನೇಜ್ಡ್ ಫಾರ್ಮ್‌ಲ್ಯಾಂಡ್‌ಗೆ ಸ್ವಾಗತ. ನನ್ನ ಹೆಸರು ಪ್ರಿಯಾ, ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?' : 'Hello! Thank you for calling Prestige Managed Farmlands. My name is Priya, how can I help you today?')
      : `Good afternoon! Thank you for calling ${tenant.businessName}. My name is ${tenant.personaName || 'Clara'}. Are you looking to book an appointment today?`;

    session.history.push({ role: 'ai', text: greeting });

    return twimlSayGather(vConfig, greeting);
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

  const isConfirmed = dialog.isConfirmedBookingReply(reply);

  // Trigger Booking & SMS/WhatsApp Notification if Confirmed
  if (isConfirmed || dialog.isConfirmedBookingReply(reply)) {
    const finalName = session.callerName || extractedName || 'Pradeep Kumar';
    const finalSlot = requestedSlot || 'Tomorrow at 12:30 PM';

    console.log(`🎉 [Booking Confirmed via Phone Call] ${finalName} @ ${finalSlot}`);

    try {
      await bookingEngine.createBooking({
        tenantId: session.tenant.id,
        clinicName: session.tenant.businessName,
        patientName: finalName,
        patientPhone: fromNumber,
        treatment: session.tenant.industry === 'realestate' ? 'Weekend Farmland Site Visit' : 'Dental Consultation & Cleaning',
        slotTime: finalSlot,
        doctorName: session.tenant.ownerName || 'Dr. Harley',
        doctorPhone: session.tenant.doctorWhatsApp || session.tenant.doctorPhone || '+919845012345',
        transcript: session.history
      });
    } catch(e) {
      console.error('[Booking Save Error]:', e.message);
    }

    // Cleanly close session and hang up phone
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
  const isFarewell = low.includes('bye') || low.includes('thank you, goodbye') || low.includes('ಧನ್ಯವಾದಗಳು, ಬಾಯ್') || low.includes('thanks bye');

  if (isFarewell) {
    callHistories.delete(callSid);
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${turnVConfig.voice}" language="${turnVConfig.lang}">${escapeXml(reply)}</Say>
  <Hangup />
</Response>`;
  }

  // Continue Conversation
  return twimlSayGather(turnVConfig, reply);
}

function inboundActionUrl() {
  const base = (require('../services/integrations').appBaseUrl() || '').replace(/\/$/, '');
  return (base || '') + '/v1/telephony/inbound';
}

function twimlSayGather(vConfig, text) {
  const action = inboundActionUrl();
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${vConfig.voice}" language="${vConfig.lang}">${escapeXml(text)}</Say>
  <Gather input="speech" action="${escapeXml(action)}" method="POST" speechTimeout="auto" speechModel="phone_call" enhanced="true" language="${vConfig.lang}">
  </Gather>
  <Say voice="${vConfig.voice}" language="${vConfig.lang}">I am still on the line. Are you looking to book an appointment with Dr. Harley?</Say>
  <Gather input="speech" action="${escapeXml(action)}" method="POST" speechTimeout="auto" speechModel="phone_call" enhanced="true" language="${vConfig.lang}">
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

module.exports = { handleInboundCall };
