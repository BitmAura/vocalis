const { request } = require('./https-request');
const { appBaseUrl } = require('./integrations');

class OutboundAutoCallEngine {
  constructor() {
    this.twilioSid = process.env.TWILIO_ACCOUNT_SID || '';
    this.twilioToken = process.env.TWILIO_AUTH_TOKEN || '';
    this.twilioFrom = process.env.TWILIO_PHONE_NUMBER || '';
  }

  async triggerMissedCallCallback(leadData) {
    const leadPhone = leadData.leadPhone;
    if (!leadPhone) {
      return { success: false, status: 'MISSING_LEAD_PHONE' };
    }
    if (!this.twilioSid || !this.twilioToken || !this.twilioFrom) {
      return {
        success: false,
        status: 'TWILIO_NOT_CONFIGURED',
        leadPhone,
        adSource: leadData.adSource || null
      };
    }
    const base = appBaseUrl();
    if (!base.startsWith('https://')) {
      return {
        success: false,
        status: 'PUBLIC_BASE_URL_REQUIRED',
        reason: 'Set VOCALIS_BASE_URL (or PUBLIC_BASE_URL as Config, not Secret) to https://vocalis-sigma-lake.vercel.app',
        leadPhone
      };
    }

    const auth = Buffer.from(this.twilioSid + ':' + this.twilioToken).toString('base64');
    const form = new URLSearchParams({
      To: leadPhone,
      From: this.twilioFrom,
      Url: base + '/v1/telephony/inbound',
      Method: 'POST'
    }).toString();

    const res = await request({
      hostname: 'api.twilio.com',
      path: '/2010-04-01/Accounts/' + this.twilioSid + '/Calls.json',
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + auth,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(form)
      },
      body: form
    });

    let parsed = {};
    try { parsed = JSON.parse(res.body); } catch (e) {}
    const ok = res.status >= 200 && res.status < 300;
    return {
      success: ok,
      status: ok ? 'QUEUED' : 'TWILIO_CALL_FAILED',
      callId: parsed.sid || null,
      httpStatus: res.status,
      reason: ok ? null : (parsed.message || res.body.slice(0, 300)),
      leadPhone,
      adSource: leadData.adSource || null,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = new OutboundAutoCallEngine();
