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
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.logsFile)) {
      fs.writeFileSync(this.logsFile, JSON.stringify([], null, 2), 'utf8');
    }
    this.seedInitialLogs();
  }

  seedInitialLogs() {
    const existing = this.getAllLogs();
    if (existing.length === 0) {
      const samples = [
        {
          id: 'CAL-9901',
          tenantId: 'TNT-001',
          clinicName: 'Harley Street Smiles Dental',
          callerPhone: '+44 7700 900123',
          callerName: 'Maria Johnson',
          durationSeconds: 114,
          language: 'en-GB',
          intent: 'New Patient Cleaning & Toothache',
          sentiment: 'Positive (Relieved)',
          bookingStatus: 'BOOKED_FRIDAY_230PM',
          revenueRecovered: '£140.00',
          timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
          transcript: [
            { speaker: 'ai', text: 'Good afternoon! Thank you for calling Harley Street Smiles Dental. My name is Clara. Are you a new patient or visiting us again?' },
            { speaker: 'caller', text: 'Hi Clara, I am a new patient. I have a throbbing toothache on my lower right side and need an urgent appointment.' },
            { speaker: 'ai', text: 'I am so sorry to hear you are in pain! We keep daily emergency slots open. Dr. Harley has availability today at 4:00 PM or this Friday at 2:30 PM. Which works best for you?' },
            { speaker: 'caller', text: 'Friday at 2:30 PM would be perfect. My name is Maria Johnson.' },
            { speaker: 'ai', text: 'Splendid Maria! You are confirmed for this Friday at 2:30 PM with Dr. Harley. I have sent an SMS confirmation to your mobile, and Dr. Harley has been notified on WhatsApp. Is there anything else I can assist you with today?' }
          ],
          audioUrl: 'https://app.vocalis.ai/recordings/call_rec_9901.mp3'
        },
        {
          id: 'CAL-9902',
          tenantId: 'TNT-002',
          clinicName: 'Prestige Nature Farmland & Estates',
          callerPhone: '+91 98450 88712',
          callerName: 'Rajesh Kumar',
          durationSeconds: 156,
          language: 'kn',
          intent: 'Meta Ad Inbound - 1 Acre Farmland Site Visit',
          sentiment: 'High Purchase Intent',
          bookingStatus: 'SITE_VISIT_CONFIRMED',
          revenueRecovered: '₹25,00,000 Deal Pipeline',
          timestamp: new Date(Date.now() - 3600000 * 5).toISOString(),
          transcript: [
            { speaker: 'ai', text: 'ನಮಸ್ಕಾರ ಸರ್! ಪ್ರೆಸ್ಟೀಜ್ ಮ್ಯಾನೇಜ್ಡ್ ಫಾರ್ಮ್‌ಲ್ಯಾಂಡ್ ಅಂಡ್ ಎಸ್ಟೇಟ್ಸ್‌ಗೆ ಸ್ವಾಗತ. ನೀವು ಇನ್‌ಸ್ಟಾಗ್ರಾಮ್ ಜಾಹೀರಾತು ನೋಡಿ ಕಾಲ್ ಮಾಡಿದ್ದೀರಾ? ನೀವು ಬಂಡವಾಳ ಹೂಡಿಕೆಗಾಗಿ ಅಥವಾ ಸ್ವಂತ ಫಾರ್ಮ್‌ಹೌಸ್‌ಗಾಗಿ ನೋಡ್ತಿದ್ದೀರಾ?' },
            { speaker: 'caller', text: 'ಹೌದು, ನಾನು 1 ಎಕರೆ ಮ್ಯಾನೇಜ್ಡ್ ಫಾರ್ಮ್‌ಲ್ಯಾಂಡ್ ಇನ್ವೆಸ್ಟ್‌ಮೆಂಟ್‌ಗಾಗಿ ನೋಡ್ತಿದ್ದೀನಿ. ಸೈಟ್ ವಿಸಿಟ್ ಮಾಡಬಹುದಾ?' },
            { speaker: 'ai', text: 'ಖಂಡಿತ ಸರ್! ಈ ಶನಿವಾರ ಬೆಳಿಗ್ಗೆ 10:00 ಗಂಟೆಗೆ ನಮ್ಮ ಎಸಿ ಕ್ಯಾಬ್ ಪಿಕಪ್ ಸೌಲಭ್ಯವಿದೆ. ಬುಕಿಂಗ್ ಕನ್ಫರ್ಮ್ ಮಾಡಲು ನಿಮ್ಮ ಪೂರ್ಣ ಹೆಸರು ತಿಳಿಸಬಹುದಾ?' },
            { speaker: 'caller', text: 'ನನ್ನ ಹೆಸರು ರಾಜೇಶ್ ಕುಮಾರ್, ಹೆಬ್ಬಾಳದಿಂದ.' },
            { speaker: 'ai', text: 'ಧನ್ಯವಾದಗಳು ರಾಜೇಶ್ ಸರ್! ಶನಿವಾರ ಬೆಳಿಗ್ಗೆ 10:00 ಗಂಟೆಯ ಸೈಟ್ ವಿಸಿಟ್ ಕನ್ಫರ್ಮ್ ಆಗಿದೆ. ನಿಮಗೆ ಲೊಕೇಶನ್ ಪಿನ್ ಎಸ್ಸೆಮ್ಮೆಸ್ ಮಾಡಲಾಗಿದೆ ಮತ್ತು ಸೇಲ್ಸ್ ಮ್ಯಾನೇಜರ್ ವಿಕ್ರಮ್ ಅವರಿಗೆ ವಾಟ್ಸಾಪ್ ಕಳುಹಿಸಲಾಗಿದೆ!' }
          ],
          audioUrl: 'https://app.vocalis.ai/recordings/call_rec_9902.mp3'
        }
      ];
      fs.writeFileSync(this.logsFile, JSON.stringify(samples, null, 2), 'utf8');
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
      callerPhone: logData.callerPhone || '+44 7700 900123',
      callerName: logData.callerName || 'Anonymous Caller',
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
    fs.writeFileSync(this.logsFile, JSON.stringify(all, null, 2), 'utf8');
    return newLog;
  }

  getSummaryMetrics(tenantId) {
    const logs = tenantId ? this.getLogsByTenant(tenantId) : this.getAllLogs();
    const totalCalls = logs.length;
    const bookedCalls = logs.filter(l => l.bookingStatus.includes('BOOKED') || l.bookingStatus.includes('CONFIRMED')).length;
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
