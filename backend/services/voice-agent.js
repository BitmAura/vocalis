/**
 * Voice session — tenant + language aware, no hardcoded Maria Johnson.
 */
const dialog = require('./dialog-engine');
const WhatsAppDispatcher = require('./whatsapp-dispatcher');
const CalendarSyncService = require('./calendar-sync');

class VoiceAgentSession {
  constructor(tenantConfig = {}) {
    this.tenantId = tenantConfig.tenantId || 'TNT-001';
    this.businessName = tenantConfig.businessName || 'Harley Street Smiles Dental';
    this.industry = tenantConfig.industry || 'dental';
    this.endingGoal = tenantConfig.endingGoal || 'booking';
    this.doctorPhone = tenantConfig.doctorPhone || '';
    this.personaName = tenantConfig.personaName || 'Clara';
    this.language = dialog.normalizeLanguage(tenantConfig.language || 'en-GB');
    this.address = tenantConfig.address || '';
    this.ownerName = tenantConfig.ownerName || tenantConfig.doctorName || '';
    this.workingHours = tenantConfig.workingHours || '';

    this.whatsApp = new WhatsAppDispatcher();
    this.calendar = new CalendarSyncService();
    this.callTranscript = [];
    this.history = [];
    this.state = {
      stage: 1,
      callerName: '',
      callerPhone: tenantConfig.callerPhone || '',
      slot: 'Tomorrow at 12:30 PM'
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
      await this.calendar.bookSlot(
        this.state.callerName,
        '',
        this.state.callerPhone,
        this.state.slot,
        this.industry
      );
      await this.whatsApp.sendConfirmedBookingAlert(this.doctorPhone, {
        patientName: this.state.callerName,
        patientPhone: this.state.callerPhone,
        treatment: this.industry,
        treatmentFee: '',
        slotTime: this.state.slot,
        clinicName: this.businessName,
        conversationScript: callerText,
        audioUrl: ''
      });
      actionTriggered = 'BOOKING_LIFECYCLE_COMPLETED_AND_WHATSAPP_DISPATCHED';
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
