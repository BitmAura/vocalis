/**
 * Orchestrates cancel / reschedule flows for phone and chat.
 */
const bookingEngine = require('./booking-engine');
const bookingIntents = require('./booking-intents');
const dialog = require('./dialog-engine');

async function processBookingLifecycle(ctx) {
  const {
    message,
    lang,
    tenantId,
    patientPhone,
    clinicName,
    doctorPhone,
    requestedSlot,
    history,
    session
  } = ctx;

  const state = session || {};
  const bookingId = state.pendingBookingId || null;

  // Confirm pending cancel
  if (state.pendingAction === 'cancel_confirm') {
    if (bookingIntents.isAffirmative(message)) {
      const result = await bookingEngine.cancelBooking({
        tenantId,
        patientPhone,
        bookingId,
        doctorPhone,
        clinicName,
        language: lang
      });
      if (state.pendingAction !== undefined) {
        state.pendingAction = null;
        state.pendingBookingId = null;
      }
      if (!result.success) {
        return { handled: true, reply: bookingIntents.noBookingReply(lang), action: 'none' };
      }
      return {
        handled: true,
        reply: bookingIntents.cancelDoneReply(lang, result.booking.slotTime),
        action: 'cancelled',
        booking: result.booking,
        hangup: true
      };
    }
    if (bookingIntents.isNegative(message)) {
      state.pendingAction = null;
      state.pendingBookingId = null;
      const keep = {
        hi: 'Theek hai, aapki appointment waise hi rehti hai. Aur kuch help chahiye?',
        kn: 'Sari, appointment adhe ide. Bere help beku?',
        te: 'Sare, appointment ade undi. Inka help kavala?',
        ta: 'Sari, appointment adhe irukku. Vera help venuma?',
        'en-IN': 'No problem — your appointment stays as it is. Anything else I can help with?'
      };
      return { handled: true, reply: keep[lang] || keep['en-IN'], action: 'none' };
    }
  }

  // Pending reschedule — waiting for new slot
  if (state.pendingAction === 'reschedule_slot') {
    const newSlot = requestedSlot || dialog.parseRequestedSlot(message, history || []);
    if (newSlot) {
      const existing = bookingEngine.getBookingById(bookingId) ||
        bookingEngine.findUpcomingByPhone(tenantId, patientPhone);
      const result = await bookingEngine.rescheduleBooking({
        tenantId,
        patientPhone,
        bookingId: existing && existing.id,
        newSlotTime: newSlot,
        doctorPhone,
        clinicName,
        language: lang
      });
      state.pendingAction = null;
      state.pendingBookingId = null;
      if (!result.success) {
        return { handled: true, reply: bookingIntents.noBookingReply(lang), action: 'none' };
      }
      return {
        handled: true,
        reply: bookingIntents.rescheduleDoneReply(lang, result.previousSlotTime, newSlot),
        action: 'rescheduled',
        booking: result.booking,
        hangup: true
      };
    }
  }

  // New cancel intent
  if (bookingIntents.isCancelIntent(message)) {
    const booking = bookingEngine.findUpcomingByPhone(tenantId, patientPhone);
    if (!booking) {
      return { handled: true, reply: bookingIntents.noBookingReply(lang), action: 'none' };
    }
    state.pendingAction = 'cancel_confirm';
    state.pendingBookingId = booking.id;
    return {
      handled: true,
      reply: bookingIntents.cancelConfirmReply(lang, booking.slotTime),
      action: 'awaiting_cancel_confirm',
      booking
    };
  }

  // New reschedule intent
  if (bookingIntents.isRescheduleIntent(message)) {
    const booking = bookingEngine.findUpcomingByPhone(tenantId, patientPhone);
    if (!booking) {
      return { handled: true, reply: bookingIntents.noBookingReply(lang), action: 'none' };
    }
    const newSlot = requestedSlot || dialog.parseRequestedSlot(message, history || []);
    if (newSlot) {
      const result = await bookingEngine.rescheduleBooking({
        tenantId,
        patientPhone,
        bookingId: booking.id,
        newSlotTime: newSlot,
        doctorPhone,
        clinicName,
        language: lang
      });
      if (!result.success) {
        return { handled: true, reply: bookingIntents.noBookingReply(lang), action: 'none' };
      }
      return {
        handled: true,
        reply: bookingIntents.rescheduleDoneReply(lang, result.previousSlotTime, newSlot),
        action: 'rescheduled',
        booking: result.booking,
        hangup: true
      };
    }
    state.pendingAction = 'reschedule_slot';
    state.pendingBookingId = booking.id;
    return {
      handled: true,
      reply: bookingIntents.rescheduleAskReply(lang, booking.slotTime),
      action: 'awaiting_reschedule_slot',
      booking
    };
  }

  // LLM said cancelled/rescheduled — execute if we have a booking
  return { handled: false };
}

async function executeFromLlmReply({ reply, lang, tenantId, patientPhone, clinicName, doctorPhone, requestedSlot }) {
  if (bookingIntents.isCancelledReply(reply)) {
    const booking = bookingEngine.findUpcomingByPhone(tenantId, patientPhone);
    if (booking) {
      const result = await bookingEngine.cancelBooking({
        tenantId, patientPhone, bookingId: booking.id, doctorPhone, clinicName, language: lang
      });
      return { executed: result.success, action: 'cancelled', booking: result.booking };
    }
  }
  if (bookingIntents.isRescheduledReply(reply) && requestedSlot) {
    const booking = bookingEngine.findUpcomingByPhone(tenantId, patientPhone);
    if (booking) {
      const result = await bookingEngine.rescheduleBooking({
        tenantId, patientPhone, bookingId: booking.id, newSlotTime: requestedSlot, doctorPhone, clinicName, language: lang
      });
      return { executed: result.success, action: 'rescheduled', booking: result.booking };
    }
  }
  return { executed: false };
}

module.exports = { processBookingLifecycle, executeFromLlmReply };
