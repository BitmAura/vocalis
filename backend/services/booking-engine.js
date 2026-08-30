const fs = require('fs');
const path = require('path');
const WhatsAppDispatcher = require('./whatsapp-dispatcher');
const CalendarSyncService = require('./calendar-sync');

function normalizePhoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function phonesMatch(a, b) {
  const da = normalizePhoneDigits(a);
  const db = normalizePhoneDigits(b);
  if (da.length < 10 || db.length < 10) return false;
  return da.slice(-10) === db.slice(-10);
}

class BookingEngine {
  constructor() {
    this.bookingsFile = path.join(__dirname, '..', 'bookings', 'bookings.json');
    const bookingsDir = path.dirname(this.bookingsFile);
    if (!fs.existsSync(bookingsDir)) {
      try { fs.mkdirSync(bookingsDir, { recursive: true }); } catch (e) {}
    }
    if (!fs.existsSync(this.bookingsFile)) {
      try { fs.writeFileSync(this.bookingsFile, JSON.stringify([], null, 2), 'utf8'); } catch (e) {}
    }
    this.whatsApp = new WhatsAppDispatcher();
    this.calendar = new CalendarSyncService();
  }

  _readAll() {
    try {
      return JSON.parse(fs.readFileSync(this.bookingsFile, 'utf8'));
    } catch (e) {
      return [];
    }
  }

  _writeAll(all) {
    try { fs.writeFileSync(this.bookingsFile, JSON.stringify(all, null, 2), 'utf8'); } catch (e) {}
  }

  getAllBookings() {
    return this._readAll();
  }

  getBookingsByTenant(tenantId) {
    return this.getAllBookings().filter((b) => b.tenantId === tenantId);
  }

  findUpcomingByPhone(tenantId, patientPhone) {
    const all = this.getAllBookings();
    const matches = all.filter((b) =>
      b.tenantId === tenantId &&
      b.status === 'CONFIRMED' &&
      phonesMatch(b.patientPhone, patientPhone)
    );
    return matches[0] || null;
  }

  getBookingById(bookingId) {
    return this.getAllBookings().find((b) => b.id === bookingId) || null;
  }

  getAvailableSlots(tenantId) {
    return this.calendar.getAvailableSlots();
  }

  async createBooking(bookingData) {
    const all = this._readAll();
    const conflict = all.find((b) =>
      b.tenantId === bookingData.tenantId &&
      b.status === 'CONFIRMED' &&
      String(b.slotTime).toLowerCase() === String(bookingData.slotTime).toLowerCase() &&
      phonesMatch(b.patientPhone, bookingData.patientPhone) === false
    );

    if (conflict) {
      return {
        success: false,
        error: 'SLOT_CONFLICT',
        message: 'That slot is already reserved locally.'
      };
    }

    const cal = await this.calendar.bookSlot(
      bookingData.patientName,
      bookingData.patientEmail || '',
      bookingData.patientPhone,
      bookingData.slotTime,
      bookingData.treatment,
      bookingData.doctorName
    );

    const newBooking = {
      id: 'BKG-' + Date.now(),
      tenantId: bookingData.tenantId || 'TNT-001',
      clinicName: bookingData.clinicName || '',
      patientName: bookingData.patientName || '',
      patientPhone: bookingData.patientPhone || '',
      treatment: bookingData.treatment || '',
      treatmentFee: bookingData.treatmentFee || '',
      slotTime: bookingData.slotTime || '',
      doctorName: bookingData.doctorName || '',
      doctorPhone: bookingData.doctorPhone || '',
      status: 'CONFIRMED',
      bookedAt: new Date().toISOString(),
      symptoms: bookingData.symptoms || '',
      audioUrl: bookingData.audioUrl || '',
      calendarSynced: !!cal.success,
      calendar: { provider: cal.provider || null, success: cal.success, status: cal.status, bookingId: cal.bookingId || null, reason: cal.reason || null }
    };

    const wa = await this.whatsApp.sendConfirmedBookingAlert(newBooking.doctorPhone, {
      patientName: newBooking.patientName,
      patientPhone: newBooking.patientPhone,
      treatment: newBooking.treatment,
      treatmentFee: newBooking.treatmentFee,
      slotTime: newBooking.slotTime,
      clinicName: newBooking.clinicName,
      conversationSummary: newBooking.symptoms,
      transcript: bookingData.transcript || [],
      audioUrl: newBooking.audioUrl,
      language: bookingData.language
    });
    newBooking.whatsapp = { success: wa.success, status: wa.status, provider: wa.provider, smsToCaller: wa.smsToCaller };

    all.unshift(newBooking);
    this._writeAll(all);

    return { success: true, booking: newBooking };
  }

  async cancelBooking({ tenantId, patientPhone, bookingId, doctorPhone, clinicName, language }) {
    const all = this._readAll();
    let booking = bookingId ? all.find((b) => b.id === bookingId) : null;
    if (!booking) booking = this.findUpcomingByPhone(tenantId, patientPhone);

    if (!booking || booking.status !== 'CONFIRMED') {
      return { success: false, error: 'NOT_FOUND', message: 'No confirmed appointment found for this number.' };
    }

    const calEventId = booking.calendar && booking.calendar.bookingId;
    const cal = await this.calendar.cancelSlot(calEventId);

    booking.status = 'CANCELLED';
    booking.cancelledAt = new Date().toISOString();
    booking.calendarCancelled = cal.success;

    const idx = all.findIndex((b) => b.id === booking.id);
    if (idx >= 0) all[idx] = booking;
    this._writeAll(all);

    const notify = await this.whatsApp.sendBookingChangeAlert({
      type: 'cancel',
      doctorPhone: doctorPhone || booking.doctorPhone,
      patientName: booking.patientName,
      patientPhone: booking.patientPhone,
      slotTime: booking.slotTime,
      clinicName: clinicName || booking.clinicName,
      language
    });

    return { success: true, booking, calendar: cal, notification: notify };
  }

  async rescheduleBooking({ tenantId, patientPhone, bookingId, newSlotTime, doctorPhone, clinicName, language }) {
    if (!newSlotTime) {
      return { success: false, error: 'NO_SLOT', message: 'New slot time is required.' };
    }

    const all = this._readAll();
    let booking = bookingId ? all.find((b) => b.id === bookingId) : null;
    if (!booking) booking = this.findUpcomingByPhone(tenantId, patientPhone);

    if (!booking || booking.status !== 'CONFIRMED') {
      return { success: false, error: 'NOT_FOUND', message: 'No confirmed appointment found for this number.' };
    }

    const oldSlot = booking.slotTime;
    const calEventId = booking.calendar && booking.calendar.bookingId;
    const cal = await this.calendar.rescheduleSlot(
      calEventId,
      booking.patientName,
      booking.patientPhone,
      newSlotTime,
      booking.treatment,
      booking.doctorName
    );

    booking.previousSlotTime = oldSlot;
    booking.slotTime = newSlotTime;
    booking.rescheduledAt = new Date().toISOString();
    if (cal.success && cal.bookingId) {
      booking.calendar = { ...(booking.calendar || {}), bookingId: cal.bookingId, success: true };
    }

    const idx = all.findIndex((b) => b.id === booking.id);
    if (idx >= 0) all[idx] = booking;
    this._writeAll(all);

    const notify = await this.whatsApp.sendBookingChangeAlert({
      type: 'reschedule',
      doctorPhone: doctorPhone || booking.doctorPhone,
      patientName: booking.patientName,
      patientPhone: booking.patientPhone,
      slotTime: newSlotTime,
      previousSlotTime: oldSlot,
      clinicName: clinicName || booking.clinicName,
      language
    });

    return { success: true, booking, previousSlotTime: oldSlot, calendar: cal, notification: notify };
  }
}

module.exports = new BookingEngine();
