/**
 * Cal.com v2 booking. Without CAL_API_KEY + CAL_EVENT_TYPE_ID, does not invent a booking.
 */
const { request } = require('./https-request');

class CalendarSyncService {
  constructor() {
    this.apiKey = process.env.CAL_API_KEY || '';
    this.eventTypeId = parseInt(process.env.CAL_EVENT_TYPE_ID || '', 10);
  }

  isConfigured() {
    return !!(this.apiKey && this.eventTypeId);
  }

  async getAvailableSlots() {
    if (!this.isConfigured()) {
      return { success: false, reason: 'CAL_API_KEY or CAL_EVENT_TYPE_ID missing', slots: [] };
    }
    const start = new Date().toISOString();
    const end = new Date(Date.now() + 7 * 86400000).toISOString();
    const qs = 'eventTypeId=' + this.eventTypeId + '&start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end);
    const res = await request({
      hostname: 'api.cal.com',
      path: '/v2/slots?' + qs,
      method: 'GET',
      headers: { Authorization: 'Bearer ' + this.apiKey, 'cal-api-version': '2024-08-13' }
    });
    if (res.status < 200 || res.status >= 300) {
      return { success: false, reason: 'Cal.com slots HTTP ' + res.status, slots: [], raw: res.body.slice(0, 400) };
    }
    return { success: true, slots: res.body, rawStatus: res.status };
  }

  async bookSlot(patientName, patientEmail, patientPhone, slotTime, treatmentType) {
    if (!this.isConfigured()) {
      return {
        success: false,
        status: 'NOT_SYNCED',
        reason: 'CAL_API_KEY or CAL_EVENT_TYPE_ID missing',
        slot: slotTime,
        patient: { name: patientName, phone: patientPhone, email: patientEmail },
        treatment: treatmentType
      };
    }

    const startIso = this._slotToIso(slotTime);
    const payload = JSON.stringify({
      start: startIso,
      eventTypeId: this.eventTypeId,
      attendee: {
        name: patientName || 'Caller',
        email: patientEmail || 'guest@vocalis.local',
        timeZone: process.env.CAL_TIMEZONE || 'Europe/London',
        language: 'en'
      },
      metadata: { phone: patientPhone || '', treatment: treatmentType || '' }
    });

    const res = await request({
      hostname: 'api.cal.com',
      path: '/v2/bookings',
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + this.apiKey,
        'Content-Type': 'application/json',
        'cal-api-version': '2024-08-13',
        'Content-Length': Buffer.byteLength(payload)
      },
      body: payload
    });

    let parsed = {};
    try { parsed = JSON.parse(res.body); } catch (e) {}
    const ok = res.status >= 200 && res.status < 300;
    return {
      success: ok,
      status: ok ? 'CONFIRMED' : 'CAL_FAILED',
      bookingId: (parsed.data && parsed.data.uid) || parsed.uid || null,
      httpStatus: res.status,
      reason: ok ? null : (parsed.message || res.body.slice(0, 300)),
      slot: slotTime,
      patient: { name: patientName, phone: patientPhone, email: patientEmail },
      treatment: treatmentType
    };
  }

  _slotToIso(slotTime) {
    const d = new Date();
    d.setHours(12, 30, 0, 0);
    const low = String(slotTime || '').toLowerCase();
    if (low.includes('tomorrow')) d.setDate(d.getDate() + 1);
    const m = low.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    if (m) {
      let h = parseInt(m[1], 10);
      const min = parseInt(m[2] || '0', 10);
      const ap = (m[3] || '').toLowerCase();
      if (ap === 'pm' && h < 12) h += 12;
      if (ap === 'am' && h === 12) h = 0;
      d.setHours(h, min, 0, 0);
    }
    return d.toISOString();
  }
}

module.exports = CalendarSyncService;
