const fs = require('fs');
const path = require('path');
const { request } = require('./https-request');

const ALERTS_FILE = path.join(__dirname, '..', 'data', 'doctor_alerts.json');

const LANG_DISPLAY = {
  kn: 'Kannada',
  te: 'Telugu',
  ta: 'Tamil',
  hi: 'Hindi',
  'en-GB': 'English (UK)',
  'en-US': 'English (US)',
  'en-IN': 'English (India)',
  ar: 'Arabic',
  fr: 'French'
};

class WhatsAppDispatcher {
  constructor() {
    this.ensureAlertsStore();
  }

  ensureAlertsStore() {
    const dir = path.dirname(ALERTS_FILE);
    if (!fs.existsSync(dir)) try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    if (!fs.existsSync(ALERTS_FILE)) try { fs.writeFileSync(ALERTS_FILE, '[]', 'utf8'); } catch (e) {}
  }

  digits(n) {
    return String(n || '').replace(/\D/g, '');
  }

  async sendSMS(toNumber, bodyText) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    if (!sid || !token || !fromNumber || !toNumber || String(toNumber).includes('Unknown')) {
      return false;
    }
    const auth = Buffer.from(sid + ':' + token).toString('base64');
    const data = new URLSearchParams({ To: toNumber, From: fromNumber, Body: bodyText }).toString();
    const res = await request({
      hostname: 'api.twilio.com',
      path: '/2010-04-01/Accounts/' + sid + '/Messages.json',
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + auth,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data)
      },
      body: data
    });
    return res.status >= 200 && res.status < 300;
  }

  async sendWhatsApp(toNumber, bodyText) {
    const gupshupKey = process.env.GUPSHUP_API_KEY;
    const gupshupApp = process.env.GUPSHUP_APP_NAME;
    const gupshupSrc = process.env.GUPSHUP_SOURCE;
    if (gupshupKey && gupshupApp && gupshupSrc && toNumber) {
      const dest = this.digits(toNumber);
      const src = this.digits(gupshupSrc);
      const form = new URLSearchParams({
        channel: 'whatsapp',
        source: src,
        destination: dest,
        'src.name': gupshupApp,
        message: JSON.stringify({ type: 'text', text: bodyText })
      }).toString();
      const res = await request({
        hostname: 'api.gupshup.io',
        path: '/wa/api/v1/msg',
        method: 'POST',
        headers: {
          apikey: gupshupKey,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(form)
        },
        body: form
      });
      return {
        provider: 'gupshup',
        success: res.status >= 200 && res.status < 300,
        httpStatus: res.status,
        body: res.body.slice(0, 400)
      };
    }

    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const fromWa = process.env.TWILIO_WHATSAPP_FROM;
    if (sid && token && fromWa && toNumber) {
      const auth = Buffer.from(sid + ':' + token).toString('base64');
      const data = new URLSearchParams({
        To: 'whatsapp:' + (String(toNumber).startsWith('+') ? toNumber : '+' + this.digits(toNumber)),
        From: fromWa.startsWith('whatsapp:') ? fromWa : 'whatsapp:' + fromWa,
        Body: bodyText
      }).toString();
      const res = await request({
        hostname: 'api.twilio.com',
        path: '/2010-04-01/Accounts/' + sid + '/Messages.json',
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + auth,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(data)
        },
        body: data
      });
      return {
        provider: 'twilio_whatsapp',
        success: res.status >= 200 && res.status < 300,
        httpStatus: res.status,
        body: res.body.slice(0, 400)
      };
    }

    return { provider: 'none', success: false, httpStatus: 0, body: 'GUPSHUP_* or TWILIO_WHATSAPP_FROM not set' };
  }

  async sendConfirmedBookingAlert(doctorPhone, bookingDetails) {
    const {
      patientName,
      patientPhone,
      treatment,
      treatmentFee,
      slotTime,
      clinicName,
      conversationSummary,
      transcript = [],
      audioUrl,
      language
    } = bookingDetails;

    let transcriptBlock = '';
    if (Array.isArray(transcript) && transcript.length > 0) {
      transcriptBlock = transcript.map((t) => {
        const isAI = t.role === 'ai' || t.speaker === 'ai';
        return (isAI ? 'AI: ' : (patientName || 'Caller') + ': ') + '"' + (t.text || '') + '"';
      }).join('\n');
    } else {
      transcriptBlock = 'No transcript attached.';
    }

    const gCalTitle = encodeURIComponent((treatment || 'Appointment') + ' - ' + (patientName || 'Patient'));
    const gCalDetails = encodeURIComponent('Vocalis booking for ' + patientName + ' (' + patientPhone + ')');
    const gCalUrl = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + gCalTitle + '&details=' + gCalDetails;

    const messageText =
      'VOCALIS: CONFIRMED BOOKING\n' +
      'Business: ' + (clinicName || '') + '\n' +
      'Name: ' + (patientName || '') + '\n' +
      'Phone: ' + (patientPhone || '') + '\n' +
      'Service: ' + (treatment || '') + ' (' + (treatmentFee || '') + ')\n' +
      'Time: ' + (slotTime || '') + '\n' +
      'Language: ' + (LANG_DISPLAY[language] || language || '') + '\n' +
      'Notes: ' + (conversationSummary || '') + '\n' +
      transcriptBlock + '\n' +
      'Calendar: ' + gCalUrl + '\n' +
      'Audio: ' + (audioUrl || '');

    let smsOk = false;
    if (patientPhone && !String(patientPhone).includes('Unknown')) {
      const patientMsg = 'Booking with ' + (clinicName || 'us') + ' confirmed for ' + (slotTime || 'your slot') + '.';
      smsOk = await this.sendSMS(patientPhone, patientMsg);
    }

    const wa = doctorPhone ? await this.sendWhatsApp(doctorPhone, messageText) : { success: false, provider: 'none', body: 'no doctor phone' };
    const status = wa.success ? 'SENT' : 'NOT_SENT';

    try {
      this.ensureAlertsStore();
      const existing = JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8') || '[]');
      existing.unshift({
        id: 'WA-' + Date.now(),
        doctorPhone: doctorPhone || '',
        clinicName: clinicName || '',
        patientName: patientName || '',
        slotTime: slotTime || '',
        treatment: treatment || '',
        treatmentFee: treatmentFee || '',
        messageText,
        dispatchedAt: new Date().toISOString(),
        status,
        provider: wa.provider,
        httpStatus: wa.httpStatus,
        smsToCaller: smsOk
      });
      try { fs.writeFileSync(ALERTS_FILE, JSON.stringify(existing.slice(0, 100), null, 2), 'utf8'); } catch (e) {}
    } catch (e) {
      console.error('Error saving doctor alert:', e.message);
    }

    return {
      success: wa.success,
      messageId: wa.success ? 'wa_' + Date.now() : null,
      recipient: doctorPhone,
      status,
      provider: wa.provider,
      smsToCaller: smsOk,
      reason: wa.success ? null : wa.body,
      messageText,
      timestamp: new Date().toISOString()
    };
  }

  static sendConfirmedBookingAlert(doctorPhone, bookingDetails) {
    return new WhatsAppDispatcher().sendConfirmedBookingAlert(doctorPhone, bookingDetails);
  }
}

module.exports = WhatsAppDispatcher;
module.exports.WhatsAppDispatcher = WhatsAppDispatcher;
module.exports.default = WhatsAppDispatcher;
