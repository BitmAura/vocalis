/**
 * Vocalis AI — Phase 5: TTS Engine
 * ElevenLabs for natural Indian + British voices (primary)
 * Google Cloud TTS as fallback for Indian regional languages
 * 
 * Voice IDs are pre-selected for maximum naturalness per language:
 * - Kannada/Telugu/Tamil/Hindi: Sarvam AI / Google Cloud TTS (Indian neural voices)
 * - British English: ElevenLabs "Rachel" or "Charlotte" 
 * - US English: ElevenLabs "Sarah"
 * - Arabic: ElevenLabs "Aria"
 * 
 * Activation: Set ELEVENLABS_API_KEY in .env
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { prepareSpeechText } = require('./speech-text');
const mitVoice = require('./mit-voice');

const ELEVENLABS_VOICES = {
  'en-GB': { voiceId: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel (British)' },
  'en-US': { voiceId: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella (US)' },
  'en-IN': { voiceId: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella' },
  'ar':    { voiceId: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli (Arabic)' }
};

const GOOGLE_TTS_VOICES = {
  'kn': { languageCode: 'kn-IN', name: 'kn-IN-Wavenet-A', ssmlGender: 'FEMALE' },
  'hi': { languageCode: 'hi-IN', name: 'hi-IN-Wavenet-A', ssmlGender: 'FEMALE' },
  'te': { languageCode: 'te-IN', name: 'te-IN-Standard-A', ssmlGender: 'FEMALE' },
  'ta': { languageCode: 'ta-IN', name: 'ta-IN-Wavenet-A', ssmlGender: 'FEMALE' },
  'en-GB': { languageCode: 'en-GB', name: 'en-GB-Neural2-C', ssmlGender: 'FEMALE' },
  'en-US': { languageCode: 'en-US', name: 'en-US-Neural2-H', ssmlGender: 'FEMALE' },
  'en-IN': { languageCode: 'en-IN', name: 'en-IN-Wavenet-A', ssmlGender: 'FEMALE' },
  'ar': { languageCode: 'ar-XA', name: 'ar-XA-Wavenet-A', ssmlGender: 'FEMALE' },
  'fr': { languageCode: 'fr-FR', name: 'fr-FR-Neural2-A', ssmlGender: 'FEMALE' }
};

class TTSEngine {
  constructor() {
    this.elevenLabsKey = process.env.ELEVENLABS_API_KEY || null;
    this.googleKey = process.env.GOOGLE_TTS_API_KEY || null;
    
    if (this.elevenLabsKey) {
      console.log('[TTS Engine] ElevenLabs ACTIVE (British/US/Arabic voices)');
    }
    if (this.googleKey) {
      console.log('[TTS Engine] Google Cloud TTS ACTIVE (Indian language voices)');
    }
    if (!this.elevenLabsKey && !this.googleKey) {
      console.log('[TTS] One Node server: IndicF5 + Piper child, then Google, then browser');
    }
    
    // Ensure audio output directory exists
    this.audioDir = path.join(__dirname, '..', '..', 'admin', 'assets', 'audio');
    if (!fs.existsSync(this.audioDir)) {
      try { fs.mkdirSync(this.audioDir, { recursive: true }); } catch (e) {}
    }
  }

  /**
   * Convert text to MP3 audio buffer
   * @param {string} text - Text to speak
   * @param {string} language - Language code
   * @returns {Promise<Buffer|null>} MP3 audio buffer
   */
  async synthesize(text, language) {
    const spoken = prepareSpeechText(text, language);
    const indianLangs = ['kn', 'te', 'ta', 'hi'];
    // 1. Primary: MIT Open-Source Zero-Key Studio Neural TTS (Indic + Piper + Edge)
    try {
      const local = await mitVoice.synthesizeWav(spoken, language);
      if (local && local.length > 500) return local;
    } catch(e) {
      console.warn('[TTS] MIT voice worker fallback:', e.message);
    }

    if (indianLangs.includes(language) && this.googleKey) {
      return await this._googleTTS(spoken, language);
    }

    if (this.elevenLabsKey && ELEVENLABS_VOICES[language] && !indianLangs.includes(language)) {
      return await this._elevenLabsTTS(spoken, language);
    }

    if (this.googleKey) {
      return await this._googleTTS(spoken, language);
    }

    return null;
  }

  /** Mulaw 8kHz for Twilio Media Streams realtime voice */
  async synthesizeMulaw8k(text, language) {
    const { wavOrPcmToMulaw8k } = require('./twilio-audio');
    const spoken = prepareSpeechText(text, language);

    if (this.googleKey) {
      const voice = GOOGLE_TTS_VOICES[language] || GOOGLE_TTS_VOICES['en-IN'] || GOOGLE_TTS_VOICES['en-GB'];
      const body = JSON.stringify({
        input: { text: spoken },
        voice: { languageCode: voice.languageCode, name: voice.name, ssmlGender: voice.ssmlGender },
        audioConfig: { audioEncoding: 'MULAW', sampleRateHertz: 8000, speakingRate: 0.98, pitch: 0.0 }
      });
      const mulaw = await new Promise((resolve) => {
        const req = https.request({
          hostname: 'texttospeech.googleapis.com',
          path: `/v1/text:synthesize?key=${this.googleKey}`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, (res) => {
          let data = '';
          res.on('data', (c) => { data += c; });
          res.on('end', () => {
            try {
              const p = JSON.parse(data);
              resolve(p.audioContent ? Buffer.from(p.audioContent, 'base64') : null);
            } catch (e) { resolve(null); }
          });
        });
        req.on('error', () => resolve(null));
        req.setTimeout(8000, () => { req.destroy(); resolve(null); });
        req.write(body);
        req.end();
      });
      if (mulaw && mulaw.length > 160) return mulaw;
    }

    try {
      const wav = await mitVoice.synthesizeWav(spoken, language);
      const mulaw = wavOrPcmToMulaw8k(wav);
      if (mulaw && mulaw.length > 160) return mulaw;
    } catch (e) {
      console.warn('[TTS Stream] mit-voice:', e.message);
    }

    return null;
  }

  async _elevenLabsTTS(text, language) {
    const voice = ELEVENLABS_VOICES[language];
    if (!voice || !voice.voiceId) return null;

    const body = JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2_5',  // Fastest model — lowest latency for calls
      voice_settings: {
        stability: 0.65,
        similarity_boost: 0.80,
        style: 0.20,
        use_speaker_boost: true
      }
    });

    return new Promise((resolve) => {
      const options = {
        hostname: 'api.elevenlabs.io',
        path: `/v1/text-to-speech/${voice.voiceId}`,
        method: 'POST',
        headers: {
          'xi-api-key': this.elevenLabsKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
          'Content-Length': Buffer.byteLength(body)
        }
      };

      const chunks = [];
      const req = https.request(options, (res) => {
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(Buffer.concat(chunks));
          } else {
            console.error('[TTS ElevenLabs] Error:', res.statusCode);
            resolve(null);
          }
        });
      });

      req.on('error', (e) => { console.error('[TTS ElevenLabs] Req error:', e.message); resolve(null); });
      req.setTimeout(3000, () => { req.destroy(); resolve(null); });
      req.write(body);
      req.end();
    });
  }

  async _googleTTS(text, language) {
    const voice = GOOGLE_TTS_VOICES[language] || GOOGLE_TTS_VOICES['en-GB'];
    
    const body = JSON.stringify({
      input: { text },
      voice: { languageCode: voice.languageCode, name: voice.name, ssmlGender: voice.ssmlGender },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: 0.95,
        pitch: 0.0,
        volumeGainDb: 1.0
      }
    });

    return new Promise((resolve) => {
      const options = {
        hostname: 'texttospeech.googleapis.com',
        path: `/v1/text:synthesize?key=${this.googleKey}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      };

      let data = '';
      const req = https.request(options, (res) => {
        res.on('data', c => { data += c; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.audioContent) {
              resolve(Buffer.from(parsed.audioContent, 'base64'));
            } else {
              console.error('[TTS Google] No audioContent:', data.substring(0, 200));
              resolve(null);
            }
          } catch(e) { resolve(null); }
        });
      });

      req.on('error', () => resolve(null));
      req.setTimeout(3000, () => { req.destroy(); resolve(null); });
      req.write(body);
      req.end();
    });
  }

  /**
   * Returns TwiML <Say> verb language code for Twilio fallback TTS
   */
  getTwimlVoice(language) {
    const twimlVoices = {
      'kn': { voice: 'Google.kn-IN-Wavenet-A', language: 'kn-IN' },
      'hi': { voice: 'Google.hi-IN-Wavenet-A', language: 'hi-IN' },
      'te': { voice: 'Google.te-IN-Standard-A', language: 'te-IN' },
      'ta': { voice: 'Google.ta-IN-Wavenet-A', language: 'ta-IN' },
      'en-GB': { voice: 'Google.en-GB-Neural2-C', language: 'en-GB' },
      'en-US': { voice: 'Google.en-US-Neural2-H', language: 'en-US' },
      'en-IN': { voice: 'Google.en-IN-Wavenet-A', language: 'en-IN' },
      'ar': { voice: 'Google.ar-XA-Wavenet-A', language: 'ar-XA' },
      'fr': { voice: 'Google.fr-FR-Neural2-A', language: 'fr-FR' }
    };
    return twimlVoices[language] || twimlVoices['en-GB'];
  }
}

module.exports = new TTSEngine();
