/**
 * Google Calendar — free/busy + event creation via service account JWT.
 * Share the clinic calendar with the service account email.
 *
 * Env: GOOGLE_SERVICE_ACCOUNT_JSON (stringified JSON)
 *      GOOGLE_CALENDAR_ID (calendar email, e.g. doctor@gmail.com)
 */
const crypto = require('crypto');
const { request } = require('./https-request');

function parseServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function calendarId() {
  return process.env.GOOGLE_CALENDAR_ID || '';
}

function isConfigured() {
  const sa = parseServiceAccount();
  return !!(sa && sa.client_email && sa.private_key && calendarId());
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function signJwt(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));
  const unsigned = header + '.' + claim;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  sign.end();
  const signature = sign.sign(sa.private_key.replace(/\\n/g, '\n'));
  return unsigned + '.' + base64url(signature);
}

async function getAccessToken() {
  const sa = parseServiceAccount();
  if (!sa) return null;
  const jwt = signJwt(sa);
  const body = 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + encodeURIComponent(jwt);
  const res = await request({
    hostname: 'oauth2.googleapis.com',
    path: '/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body)
    },
    body
  });
  if (res.status < 200 || res.status >= 300) return null;
  try {
    const p = JSON.parse(res.body);
    return p.access_token || null;
  } catch (e) {
    return null;
  }
}

function slotToIso(slotTime, tz) {
  const d = new Date();
  d.setHours(12, 30, 0, 0);
  const low = String(slotTime || '').toLowerCase();
  if (low.includes('tomorrow') || low.includes('naale') || low.includes('kal') || low.includes('repu')) {
    d.setDate(d.getDate() + 1);
  }
  if (low.includes('today') || low.includes('ivattu') || low.includes('aaj')) {
    // keep today
  }
  const m = low.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2] || '0', 10);
    const ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    d.setHours(h, min, 0, 0);
  }
  return { start: d, tz: tz || process.env.GOOGLE_CALENDAR_TZ || 'Asia/Kolkata' };
}

async function getFreeBusy(startIso, endIso) {
  if (!isConfigured()) return { success: false, reason: 'Google Calendar not configured', busy: [] };
  const token = await getAccessToken();
  if (!token) return { success: false, reason: 'Google OAuth token failed', busy: [] };

  const payload = JSON.stringify({
    timeMin: startIso,
    timeMax: endIso,
    items: [{ id: calendarId() }]
  });

  const res = await request({
    hostname: 'www.googleapis.com',
    path: '/calendar/v3/freeBusy',
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    },
    body: payload
  });

  if (res.status < 200 || res.status >= 300) {
    return { success: false, reason: 'freeBusy HTTP ' + res.status, busy: [] };
  }
  try {
    const p = JSON.parse(res.body);
    const cal = p.calendars && p.calendars[calendarId()];
    return { success: true, busy: (cal && cal.busy) || [] };
  } catch (e) {
    return { success: false, reason: 'freeBusy parse error', busy: [] };
  }
}

async function createEvent({ patientName, patientPhone, slotTime, treatment, doctorName, durationMin }) {
  if (!isConfigured()) {
    return { success: false, status: 'NOT_SYNCED', reason: 'GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_CALENDAR_ID missing' };
  }

  const token = await getAccessToken();
  if (!token) {
    return { success: false, status: 'GOOGLE_AUTH_FAILED', reason: 'Could not obtain Google access token' };
  }

  const { start, tz } = slotToIso(slotTime);
  const end = new Date(start.getTime() + (durationMin || 30) * 60000);

  const payload = JSON.stringify({
    summary: (treatment || 'Appointment') + ' — ' + (patientName || 'Patient'),
    description: [
      'Booked by Vocalis AI receptionist',
      'Patient: ' + (patientName || ''),
      'Phone: ' + (patientPhone || ''),
      'Doctor: ' + (doctorName || '')
    ].join('\n'),
    start: { dateTime: start.toISOString(), timeZone: tz },
    end: { dateTime: end.toISOString(), timeZone: tz }
  });

  const calId = encodeURIComponent(calendarId());
  const res = await request({
    hostname: 'www.googleapis.com',
    path: '/calendar/v3/calendars/' + calId + '/events',
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    },
    body: payload
  });

  let parsed = {};
  try { parsed = JSON.parse(res.body); } catch (e) {}
  const ok = res.status >= 200 && res.status < 300;
  return {
    success: ok,
    status: ok ? 'CONFIRMED' : 'GOOGLE_CAL_FAILED',
    bookingId: parsed.id || null,
    htmlLink: parsed.htmlLink || null,
    httpStatus: res.status,
    reason: ok ? null : (parsed.error && parsed.error.message) || res.body.slice(0, 300)
  };
}

async function deleteEvent(eventId) {
  if (!isConfigured() || !eventId) {
    return { success: false, reason: 'Google Calendar not configured or no event id' };
  }
  const token = await getAccessToken();
  if (!token) return { success: false, reason: 'Google OAuth token failed' };

  const calId = encodeURIComponent(calendarId());
  const res = await request({
    hostname: 'www.googleapis.com',
    path: '/calendar/v3/calendars/' + calId + '/events/' + encodeURIComponent(eventId),
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token }
  });
  const ok = res.status === 204 || (res.status >= 200 && res.status < 300);
  return { success: ok, httpStatus: res.status, reason: ok ? null : res.body.slice(0, 300) };
}

async function updateEvent(eventId, { patientName, patientPhone, slotTime, treatment, doctorName, durationMin }) {
  if (!isConfigured() || !eventId) {
    return { success: false, reason: 'Google Calendar not configured or no event id' };
  }
  const token = await getAccessToken();
  if (!token) return { success: false, reason: 'Google OAuth token failed' };

  const { start, tz } = slotToIso(slotTime);
  const end = new Date(start.getTime() + (durationMin || 30) * 60000);

  const payload = JSON.stringify({
    summary: (treatment || 'Appointment') + ' — ' + (patientName || 'Patient'),
    description: [
      'Rescheduled by Vocalis AI receptionist',
      'Patient: ' + (patientName || ''),
      'Phone: ' + (patientPhone || ''),
      'Doctor: ' + (doctorName || '')
    ].join('\n'),
    start: { dateTime: start.toISOString(), timeZone: tz },
    end: { dateTime: end.toISOString(), timeZone: tz }
  });

  const calId = encodeURIComponent(calendarId());
  const res = await request({
    hostname: 'www.googleapis.com',
    path: '/calendar/v3/calendars/' + calId + '/events/' + encodeURIComponent(eventId),
    method: 'PATCH',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    },
    body: payload
  });

  let parsed = {};
  try { parsed = JSON.parse(res.body); } catch (e) {}
  const ok = res.status >= 200 && res.status < 300;
  return {
    success: ok,
    bookingId: parsed.id || eventId,
    htmlLink: parsed.htmlLink || null,
    httpStatus: res.status,
    reason: ok ? null : (parsed.error && parsed.error.message) || res.body.slice(0, 300)
  };
}

module.exports = {
  isConfigured,
  getFreeBusy,
  createEvent,
  deleteEvent,
  updateEvent,
  slotToIso
};
