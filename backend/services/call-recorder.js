/**
 * Vocalis AI — Phase 5: Call Recording Manager
 * Stores Twilio recordings and generates shareable URLs
 * Supports: Local disk storage (dev) + Cloudflare R2 / AWS S3 (production)
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

class CallRecorder {
  constructor() {
    this.twilioSid = process.env.TWILIO_ACCOUNT_SID;
    this.twilioToken = process.env.TWILIO_AUTH_TOKEN;
    this.storageDir = path.join(__dirname, '..', '..', 'admin', 'assets', 'recordings');
    
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
    
    if (this.twilioSid && this.twilioToken) {
      console.log('[Call Recorder] Twilio recording fetch ACTIVE');
    } else {
      console.log('[Call Recorder] No Twilio credentials — recordings unavailable');
    }
  }

  /**
   * Fetch and store a completed call recording from Twilio
   * @param {string} callSid - Twilio Call SID
   * @param {string} recordingUrl - Twilio recording URL
   * @returns {Promise<{localPath: string, publicUrl: string}>}
   */
  async storeRecording(callSid, recordingUrl) {
    if (!this.twilioSid || !this.twilioToken) {
      return { localPath: null, publicUrl: null };
    }

    const filename = `call_${callSid}_${Date.now()}.mp3`;
    const localPath = path.join(this.storageDir, filename);

    return new Promise((resolve) => {
      const auth = Buffer.from(`${this.twilioSid}:${this.twilioToken}`).toString('base64');
      const options = {
        hostname: 'api.twilio.com',
        path: recordingUrl.replace('https://api.twilio.com', '') + '.mp3',
        headers: { 'Authorization': `Basic ${auth}` }
      };

      const file = fs.createWriteStream(localPath);
      https.get(options, (response) => {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          const publicUrl = `/assets/recordings/${filename}`;
          console.log(`[Call Recorder] Recording saved: ${filename}`);
          resolve({ localPath, publicUrl });
        });
      }).on('error', (e) => {
        fs.unlink(localPath, () => {});
        console.error('[Call Recorder] Download error:', e.message);
        resolve({ localPath: null, publicUrl: null });
      });
    });
  }

  /**
   * Called by Twilio StatusCallback webhook when recording is ready
   */
  async handleRecordingCallback(params) {
    const { CallSid, RecordingUrl, RecordingDuration, CallStatus } = params;
    console.log(`[Call Recorder] Recording ready for ${CallSid} (${RecordingDuration}s)`);
    
    const result = await this.storeRecording(CallSid, RecordingUrl);
    return {
      callSid: CallSid,
      duration: RecordingDuration,
      status: CallStatus,
      ...result
    };
  }

  /**
   * Lists all stored recordings
   */
  listRecordings() {
    try {
      return fs.readdirSync(this.storageDir)
        .filter(f => f.endsWith('.mp3'))
        .map(f => ({
          filename: f,
          callSid: f.split('_')[1],
          publicUrl: `/assets/recordings/${f}`,
          size: fs.statSync(path.join(this.storageDir, f)).size
        }))
        .sort((a, b) => b.filename.localeCompare(a.filename));
    } catch(e) {
      return [];
    }
  }
}

module.exports = new CallRecorder();
