const fs = require('fs');
const path = require('path');
const WhatsAppDispatcher = require('./whatsapp-dispatcher');
const CalendarSyncService = require('./calendar-sync');

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

  getAllBookings() {
    try {
      return JSON.parse(fs.readFileSync(this.bookingsFile, 'utf8'));
    } catch (e) {
      return [];
    }
  }

  getBookingsByTenant(tenantId) {
    return this.getAllBookings().filter((b) => b.tenantId === tenantId);
  }

  getAvailableSlots(tenantId) {
    return this.calendar.getAvailableSlots();
  }

  async createBooking(bookingData) {
    const all = this.getAllBookings();
    const conflict = all.find((b) =>
      b.tenantId === bookingData.tenantId &&
      String(b.slotTime).toLowerCase() === String(bookingData.slotTime).toLowerCase() &&
      b.status === 'CONFIRMED'
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
      bookingData.treatment
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
      calendar: { success: cal.success, status: cal.status, bookingId: cal.bookingId || null, reason: cal.reason || null }
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
      audioUrl: newBooking.audioUrl
    });
    newBooking.whatsapp = { success: wa.success, status: wa.status, provider: wa.provider, smsToCaller: wa.smsToCaller };

    all.unshift(newBooking);
    try { fs.writeFileSync(this.bookingsFile, JSON.stringify(all, null, 2), 'utf8'); } catch (e) {}

    return { success: true, booking: newBooking };
  }
}

module.exports = new BookingEngine();
