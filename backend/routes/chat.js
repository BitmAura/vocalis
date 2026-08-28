const whatsAppDispatcher = require('../services/whatsapp-dispatcher');
/**
 * Vocalis chat API — LLM first, multilingual dialog-engine fallback.
 */
const llm = require('../services/llm-engine');
const tenantStore = require('../services/tenant-store');
const bookingEngine = require('../services/booking-engine');
const callLogsStore = require('../services/call-logs-store');
const dialog = require('../services/dialog-engine');

function primaryOffer(tenant) {
  const svc = tenant.services && tenant.services[0];
  if (svc) return { treatment: svc.name, treatmentFee: svc.fee };
  if (tenant.industry === 'realestate') {
    return { treatment: 'Weekend Farmland Site Visit', treatmentFee: '₹25,00,000' };
  }
  return { treatment: 'Consultation', treatmentFee: tenant.currencySymbol ? `${tenant.currencySymbol}0` : 'TBD' };
}

async function handleChat(req, res, body) {
  let data = {};
  if (typeof body === 'object' && body !== null) {
    data = body;
  } else if (typeof body === 'string') {
    try { data = JSON.parse(body); } catch (e) {}
  }

  const { message, language, industry, tenantId, bizName, ownerName, city, personaName, history, callerPhone: reqCallerPhone } = data;
  if (!tenantId) console.warn('[Vocalis] Warning: tenantId not provided in request — falling back to default tenant');

  if (!message) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'message is required' }));
    return;
  }

  const tenant = tenantStore.getTenantById(tenantId || industry || 'TNT-001');
  const activeLang = dialog.resolveLanguage(message, language || tenant.language || 'en-GB');
  const kbAnswer = tenantStore.queryKnowledgeBase(tenant.id, message);
  const requestedSlot = dialog.parseRequestedSlot(message, history || []);
  const callerName = dialog.extractCallerName(message, history || []);

  const config = {
    tenantId: tenant.id,
    language: activeLang,
    industry: tenant.industry || industry || 'dental',
    bizName: bizName || tenant.businessName,
    ownerName: ownerName || tenant.ownerName,
    city: city || tenant.city,
    address: tenant.address || '14 Harley Street, Central London',
    workingHours: tenant.workingHours || 'Mon-Sat: 8:30 AM - 6:00 PM',
    phone: tenant.phone || '+44 20 7946 0912',
    personaName: personaName || tenant.personaName,
    services: tenant.services || [],
    kbAnswer: kbAnswer || null,
    requestedSlot,
    callerName
  };

  const skipLlm = false;
  const localTurn = dialog.processTurn({
    message,
    language: activeLang,
    industry: config.industry,
    history: history || [],
    personaName: config.personaName,
    bizName: config.bizName,
    ownerName: config.ownerName,
    address: config.address,
    workingHours: config.workingHours,
    requestedSlot,
    callerName,
    services: config.services
  });
  const result = skipLlm
    ? { reply: null, source: 'dialog_fast' }
    : await llm.chat(message, config, history || []);
  let reply = result.reply || localTurn.reply;

  let bookingCreated = null;
  const isConfirmed = dialog.isConfirmedBookingReply(reply);
  const offer = primaryOffer(tenant);

  if (isConfirmed && (localTurn.callerName || callerName) && (localTurn.requestedSlot || requestedSlot)) {
    const name = localTurn.callerName || callerName;
    const slot = localTurn.requestedSlot || requestedSlot;
    
    // Instant WhatsApp Alert to Doctor/Owner with Complete Transcript
    await whatsAppDispatcher.sendConfirmedBookingAlert(tenant.doctorWhatsApp || '+44 7911 123456', {
      patientName: name,
      patientPhone: reqCallerPhone || data.callerPhone || '+Unknown',
      treatment: offer.treatment,
      treatmentFee: offer.treatmentFee,
      slotTime: slot,
      clinicName: config.bizName,
      conversationSummary: 'Patient ' + name + ' confirmed appointment for ' + offer.treatment + ' on ' + slot + '.',
      transcript: (history || []).concat([{ role: 'user', text: message }, { role: 'ai', text: reply }]),
      audioUrl: '/assets/recordings/demo_rec.mp3',
      language: activeLang
    });

    bookingCreated = await bookingEngine.createBooking({
      tenantId: tenant.id,
      clinicName: config.bizName,
      patientName: name,
      patientPhone: reqCallerPhone || data.callerPhone || '',
      treatment: offer.treatment,
      treatmentFee: offer.treatmentFee,
      slotTime: slot,
      doctorName: config.ownerName,
      doctorPhone: tenant.doctorWhatsApp || '',
      symptoms: `Appointment confirmed for ${name} on ${slot}.`,
      audioUrl: '/assets/recordings/demo_rec.mp3'
    });

    callLogsStore.logCall({
      tenantId: tenant.id,
      clinicName: config.bizName,
      callerName: name,
      callerPhone: reqCallerPhone || data.callerPhone || '',
      durationSeconds: Number(data.durationSeconds) > 0
        ? Math.min(Number(data.durationSeconds), Number(process.env.CALL_MAX_SECONDS || 600))
        : Math.min(
            Math.round(((history || []).length + 2) * 8),
            Number(process.env.CALL_MAX_SECONDS || 180)
          ),
      language: activeLang,
      intent: `${config.bizName} Inquiry & Booking`,
      sentiment: 'High Satisfaction',
      bookingStatus: 'CONFIRMED_SLOT_BOOKED',
      revenueRecovered: offer.treatmentFee,
      transcript: (history || []).concat([{ role: 'user', text: message }, { role: 'ai', text: reply }])
    });
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    reply,
    language: activeLang,
    source: skipLlm ? (dialog.isOfflineMode() ? 'skipped_for_tests' : 'dialog_fast') : (result.source || 'intent_engine_pro'),
    model: result.model || 'vocalis-intent-orchestrator',
    tenant: config.bizName,
    callerName: localTurn.callerName || callerName,
    requestedSlot: localTurn.requestedSlot || requestedSlot,
    kbMatch: !!kbAnswer,
    booking: bookingCreated?.booking || null
  }));
}

module.exports = { handleChat };
