/**
 * Vocalis AI — Live Call Logs & Analytics Engine (Pillar 4)
 * Stores full call transcripts, audio waveform recordings, patient sentiment, and revenue recovered.
 */
const fs = require('fs');
const path = require('path');

class CallLogsStore {
  constructor() {
    this.logsFile = path.join(__dirname, '..', 'bookings', 'call_logs.json');
    const dir = path.dirname(this.logsFile);
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch(e) {}
    }
    if (!fs.existsSync(this.logsFile)) {
      try { fs.writeFileSync(this.logsFile, JSON.stringify([], null, 2), 'utf8'); } catch(e) { /* Read-only cloud filesystem fallback */ }
    }
  }

  getAllLogs() {
    try {
      return JSON.parse(fs.readFileSync(this.logsFile, 'utf8'));
    } catch(e) {
      return [];
    }
  }

  getLogsByTenant(tenantId) {
    return this.getAllLogs().filter(l => l.tenantId === tenantId);
  }

  logCall(logData) {
    const all = this.getAllLogs();
    const newLog = {
      id: 'CAL-' + Math.floor(1000 + Math.random() * 9000),
      tenantId: logData.tenantId || 'TNT-001',
      clinicName: logData.clinicName || 'Harley Street Smiles Dental',
      callerPhone: logData.callerPhone || '',
      callerName: logData.callerName || '',
      durationSeconds: logData.durationSeconds || 60,
      language: logData.language || 'en-GB',
      intent: logData.intent || 'General Inquiry',
      sentiment: logData.sentiment || 'Positive',
      bookingStatus: logData.bookingStatus || 'INQUIRY_ANSWERED',
      revenueRecovered: logData.revenueRecovered || '£140.00',
      timestamp: new Date().toISOString(),
      transcript: logData.transcript || [],
      audioUrl: logData.audioUrl || '/assets/recordings/demo_rec.mp3'
    };

    all.unshift(newLog);
    try { fs.writeFileSync(this.logsFile, JSON.stringify(all, null, 2), 'utf8'); } catch(e) { /* Read-only cloud filesystem fallback */ }
    return newLog;
  }

  getSummaryMetrics(tenantId) {
    const logs = tenantId ? this.getLogsByTenant(tenantId) : this.getAllLogs();
    const totalCalls = logs.length;
    const bookedCalls = logs.filter(l => String(l.bookingStatus || '').includes('BOOKED') || String(l.bookingStatus || '').includes('CONFIRMED')).length;
    const conversionRate = totalCalls > 0 ? Math.round((bookedCalls / totalCalls) * 100) : 0;
    
    return {
      totalCalls,
      bookedCalls,
      conversionRate: `${conversionRate}%`,
      missedCallsPrevented: totalCalls,
      totalDurationMinutes: Math.round(logs.reduce((acc, l) => acc + (l.durationSeconds || 0), 0) / 60)
    };
  }
}

module.exports = new CallLogsStore();
