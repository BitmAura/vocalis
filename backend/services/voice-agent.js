const dialog = require('./dialog-engine');
const bookingEngine = require('./booking-engine');

class VoiceAgentSession {
  constructor(tenantConfig = {}) {
    this.tenantId = tenantConfig.tenantId || 'TNT-001';
    this.businessName = tenantConfig.businessName || '';
    this.industry = tenantConfig.industry || 'dental';
    this.doctorPhone = tenantConfig.doctorPhone || '';
    this.personaName = tenantConfig.personaName || 'Clara';
    this.language = dialog.normalizeLanguage(tenantConfig.language || 'en-GB');
    this.address = tenantConfig.address || '';
    this.ownerName = tenantConfig.ownerName || tenantConfig.doctorName || '';
    this.workingHours = tenantConfig.workingHours || '';
    this.callTranscript = [];
    this.history = [];
    this.state = {
      stage: 1,
      callerName: '',
      callerPhone: tenantConfig.callerPhone || '',
      slot: ''
    };
  }

  getInitialGreeting() {
    const turn = dialog.processTurn({
      message: 'hello',
      language: this.language,
      industry: this.industry,
      personaName: this.personaName,
      bizName: this.businessName,
      ownerName: this.ownerName,
      address: this.address,
      workingHours: this.workingHours,
      history: []
    });
    return turn.reply;
  }

  async processCallerUtterance(callerText) {
    this.callTranscript.push({ speaker: 'caller', text: callerText, timestamp: new Date() });
    const lang = dialog.resolveLanguage(callerText, this.language);
    this.language = lang;

    const turn = dialog.processTurn({
      message: callerText,
      language: lang,
      industry: this.industry,
      personaName: this.personaName,
      bizName: this.businessName,
      ownerName: this.ownerName,
      address: this.address,
      workingHours: this.workingHours,
      history: this.history,
      callerName: this.state.callerName || undefined
    });

    this.history.push({ role: 'user', text: callerText }, { role: 'ai', text: turn.reply });
    if (turn.callerName) this.state.callerName = turn.callerName;
    this.state.slot = turn.requestedSlot;

    let actionTriggered = null;
    if (turn.isBookingConfirm) {
      this.state.stage = 4;
      const created = await bookingEngine.createBooking({
        tenantId: this.tenantId,
        clinicName: this.businessName,
        patientName: this.state.callerName,
        patientPhone: this.state.callerPhone,
        treatment: this.industry,
        slotTime: this.state.slot,
        doctorName: this.ownerName,
        doctorPhone: this.doctorPhone,
        symptoms: callerText
      });
      actionTriggered = created.success ? 'BOOKING_SAVED' : 'BOOKING_FAILED';
    }

    this.callTranscript.push({ speaker: 'ai', text: turn.reply, timestamp: new Date() });
    return {
      replyText: turn.reply,
      stage: this.state.stage,
      action: actionTriggered,
      language: lang,
      transcript: this.callTranscript
    };
  }
}

module.exports = VoiceAgentSession;
