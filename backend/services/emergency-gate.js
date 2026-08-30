/**
 * Deterministic medical emergency detection — runs BEFORE the LLM.
 * Matches VaaniYantra-style safety: chest pain, breathlessness, stroke, etc.
 * → 108 / 112 immediately. Separate from urgent booking (toothache → slot).
 */

const MEDICAL_PATTERNS = [
  // English
  /\bchest\s+pain\b/i,
  /\bheart\s+attack\b/i,
  /\bcan'?t\s+breathe\b/i,
  /\bcannot\s+breathe\b/i,
  /\bbreathless(ness)?\b/i,
  /\bshort(ness)?\s+of\s+breath\b/i,
  /\bsevere\s+bleeding\b/i,
  /\bunconscious\b/i,
  /\bstroke\b/i,
  /\boverdose\b/i,
  /\bsuicid(e|al)\b/i,
  /\bself[\s-]?harm\b/i,
  /\bwant\s+to\s+die\b/i,
  /\bkill\s+myself\b/i,
  /\bseizure\b/i,
  /\bconvuls(ion|ing)\b/i,
  /\bnot\s+breathing\b/i,
  // Hindi (Devanagari + Roman)
  /\b(seene|seenay|sine)\s+(mein|me)\s+dard\b/i,
  /\bsaans\s+nahi\b/i,
  /\bsans\s+nahi\b/i,
  /\bdhadkan\s+(tez|badh)\b/i,
  /\bbehosh\b/i,
  /\bheart\s+attack\b/i,
  /सीने\s+में\s+दर्द/,
  /सांस\s+नहीं/,
  /साँस\s+नहीं/,
  /बेहोश/,
  /खून\s+बह/,
  /आत्महत्या/,
  // Kannada
  /ಛಾತಿಯ\s+ನೋವು/,
  /ಉಸಿರಾಡಲು\s+ಸಾಧ್ಯವಿಲ್ಲ/,
  /ಉಸಿರು\s+ಬರುವುದಿಲ್ಲ/,
  // Telugu
  /ఛాతీ\s+నొప్పి/,
  /ఊపిరి\s+రావడం\s+లేదు/,
  // Tamil
  /மார்பு\s+வலி/,
  /மூச்சு\s+வரவில்லை/,
  // Transliterated Hindi (common on phone STT)
  /\bseene\s+mein\s+dard\b/i,
  /\bsaas\s+nahi\s+aa\s+rahi\b/i,
  /\bsans\s+nahi\b/i,
  /\bbehoosh\b/i,
  /\b108\b/,
  /\b112\b/
];

const URGENT_BOOKING_PATTERNS = [
  /\btoothache\b/i,
  /\btooth\s+pain\b/i,
  /\bdental\s+pain\b/i,
  /\burgent\b/i,
  /\bemergency\s+(slot|appointment|visit)\b/i,
  /\bpain\b/i,
  /ನೋವು/,
  /दर्द/,
  /வலி/,
  /నొప్పి/,
  /ألم/,
  /douleur/i,
  /ತುರ್ತು/,
  /طوارئ/
];

function isMedicalEmergency(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  if (!t) return false;
  // Pure "108" or "112" alone from caller asking for emergency services
  if (/^(108|112)\s*$/.test(t)) return true;
  return MEDICAL_PATTERNS.some((re) => re.test(t));
}

function isUrgentBooking(text) {
  if (!text || typeof text !== 'string') return false;
  if (isMedicalEmergency(text)) return false;
  const low = text.toLowerCase();
  return URGENT_BOOKING_PATTERNS.some((re) => re.test(low) || re.test(text));
}

function emergencyResponse(lang) {
  const l = lang || 'en-IN';
  const table = {
    hi: 'Yeh ek medical emergency lag rahi hai. Kripya turant 108 ya 112 par call karein. Main ab call band kar rahi hoon. Aapka clinic team ko alert bhej diya gaya hai.',
    kn: 'ಇದು medical emergency ಆಗಿರಬಹುದು. ದಯವಿಟ್ಟು ತಕ್ಷಣ 108 ಅಥವಾ 112 ಗೆ ಕರೆ ಮಾಡಿ. ನಾನು ಈ call ಮುಗಿಸುತ್ತಿದ್ದೇನೆ.',
    te: 'ఇది medical emergency కావచ్చు. దయచేసి వెంటనే 108 లేదా 112 కి కాల్ చేయండి. నేను ఇప్పుడు call ముగిస్తున్నాను.',
    ta: 'இது medical emergency ஆக இருக்கலாம். உடனே 108 அல்லது 112-க்கு call பண்ணுங்க. நான் இப்ப call-ஐ முடிக்கிறேன்.',
    'en-IN': 'This sounds like a medical emergency. Please call 108 or 112 immediately. I am ending this call now so you can reach emergency services.',
    'en-GB': 'This sounds like a medical emergency. Please call 999 or 112 immediately. I am ending this call now.',
    'en-US': 'This sounds like a medical emergency. Please call 911 immediately. I am ending this call now.',
    ar: 'يبدو أن هذه حالة طوارئ طبية. يرجى الاتصال بخدمات الطوارئ فوراً.',
    fr: 'Cela ressemble à une urgence médicale. Appelez le 15 ou le 112 immédiatement.'
  };
  return table[l] || table['en-IN'];
}

module.exports = {
  isMedicalEmergency,
  isUrgentBooking,
  emergencyResponse
};
