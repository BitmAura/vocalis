/**
 * Vocalis AI — Phase 5: Deepgram Real-Time STT Engine
 * Sub-300ms streaming transcription for inbound phone calls
 * Supports all 7 languages: Kannada, Hindi, Telugu, Tamil, English (GB/US), Arabic
 * 
 * Activation: Set DEEPGRAM_API_KEY in backend/.env
 * Get free key: https://console.deepgram.com
 */
const https = require('https');
const http = require('http');
const mitVoice = require('./mit-voice');

// Deepgram language model mapping
const DEEPGRAM_MODELS = {
  'en-GB': { language: 'en-GB', model: 'nova-2', keywords: ['appointment', 'doctor', 'dental', 'cleaning'] },
  'en-US': { language: 'en-US', model: 'nova-2', keywords: ['appointment', 'doctor', 'dental'] },
  'hi': { language: 'hi', model: 'nova-2-general', keywords: [] },
  'ta': { language: 'ta', model: 'nova-2-general', keywords: [] },
  'te': { language: 'te', model: 'nova-2-general', keywords: [] },
  'kn': { language: 'kn', model: 'nova-2-general', keywords: [] },
  'ar': { language: 'ar', model: 'nova-2-general', keywords: [] },
  'fr': { language: 'fr', model: 'nova-2', keywords: ['rendez-vous', 'prix', 'dentaire'] },
  'en-IN': { language: 'en-IN', model: 'nova-2', keywords: ['appointment'] }
};

class DeepgramSTTEngine {
  constructor() {
    this.apiKey = process.env.DEEPGRAM_API_KEY || null;
    this.available = !!this.apiKey;
    if (this.available) {
      console.log('[STT Engine] Deepgram Nova-2 ACTIVE');
    } else {
      console.log('[STT Engine] No DEEPGRAM_API_KEY — add to .env to enable real phone calls');
    }
  }

  /**
   * Transcribes a base64 audio buffer (from Twilio Media Streams)
   * @param {Buffer} audioBuffer - Raw mulaw/8khz audio from Twilio
   * @param {string} language - Language code (e.g. 'kn', 'hi', 'en-GB')
   * @returns {Promise<{transcript: string, confidence: number}>}
   */
  async transcribe(audioBuffer, language) {
    const indic = ['ta', 'te', 'kn', 'hi'].includes(language);
    const isWav = audioBuffer && audioBuffer.length >= 4 && audioBuffer.slice(0, 4).toString('ascii') === 'RIFF';
    if (indic && isWav) {
      const mit = await mitVoice.transcribeWav(audioBuffer, language);
      if (mit.transcript) return mit;
    }

    if (!this.available) {
      return { transcript: '', confidence: 0, source: 'unavailable' };
    }

    const langConfig = DEEPGRAM_MODELS[language] || DEEPGRAM_MODELS['en-GB'];
    const queryParams = new URLSearchParams({
      language: langConfig.language,
      model: langConfig.model,
      encoding: 'mulaw',
      sample_rate: '8000',
      channels: '1',
      punctuate: 'true',
      smart_format: 'true',
      utterances: 'false'
    });

    return new Promise((resolve) => {
      const options = {
        hostname: 'api.deepgram.com',
        path: `/v1/listen?${queryParams.toString()}`,
        method: 'POST',
        headers: {
          'Authorization': `Token ${this.apiKey}`,
          'Content-Type': 'audio/mulaw',
          'Content-Length': audioBuffer.length
        }
      };

      let data = '';
      const req = https.request(options, (res) => {
        res.on('data', c => { data += c; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const result = parsed?.results?.channels?.[0]?.alternatives?.[0];
            resolve({
              transcript: result?.transcript || '',
              confidence: result?.confidence || 0,
              source: 'deepgram'
            });
          } catch(e) {
            resolve({ transcript: '', confidence: 0, source: 'error' });
          }
        });
      });

      req.on('error', () => resolve({ transcript: '', confidence: 0, source: 'error' }));
      req.setTimeout(5000, () => { req.destroy(); resolve({ transcript: '', confidence: 0, source: 'timeout' }); });
      req.write(audioBuffer);
      req.end();
    });
  }

  /**
   * Returns the WebSocket URL for Deepgram streaming (used by Twilio Media Streams)
   */
  getStreamingUrl(language) {
    const langConfig = DEEPGRAM_MODELS[language] || DEEPGRAM_MODELS['en-GB'];
    return `wss://api.deepgram.com/v1/listen?language=${langConfig.language}&model=${langConfig.model}&encoding=mulaw&sample_rate=8000&endpointing=300`;
  }
}

module.exports = new DeepgramSTTEngine();
