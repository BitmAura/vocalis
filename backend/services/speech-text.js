/**
 * Prepare reply text so TTS engines pronounce Indian languages instead of
 * reading English tokens letter-by-letter or with a Hindi voice.
 */
const ENGLISH_SPOKEN = {
  ta: {
    WhatsApp: 'வாட்ஸ்ஆப்',
    SMS: 'எஸ் எம் எஸ்',
    AM: 'காலை',
    PM: 'மாலை',
    Dr: 'டாக்டர்',
    Harley: 'ஹார்லி'
  },
  te: {
    WhatsApp: 'వాట్సాప్',
    SMS: 'ఎస్ ఎం ఎస్',
    AM: 'ఉదయం',
    PM: 'సాయంత్రం',
    Dr: 'డాక్టర్',
    Harley: 'హార్లీ'
  },
  kn: {
    WhatsApp: 'ವಾಟ್ಸಾಪ್',
    SMS: 'ಎಸ್ ಎಂ ಎಸ್',
    AM: 'ಬೆಳಿಗ್ಗೆ',
    PM: 'ಸಂಜೆ',
    Dr: 'ಡಾಕ್ಟರ್',
    Harley: 'ಹಾರ್ಲೆ'
  },
  hi: {
    WhatsApp: 'व्हाट्सऐप',
    SMS: 'एस एम एस',
    AM: 'सुबह',
    PM: 'शाम',
    Dr: 'डॉक्टर',
    Harley: 'हार्ले'
  },
  ar: {
    WhatsApp: 'واتساب',
    SMS: 'إس إم إس'
  }
};

function prepareSpeechText(text, language) {
  if (!text) return '';
  let out = String(text).replace(/[*_#]/g, '');
  const lang = language === 'en-IN' ? 'en-IN' : language;
  const map = ENGLISH_SPOKEN[lang];
  if (map) {
    out = out.replace(/\bWhatsApp\b/gi, map.WhatsApp);
    out = out.replace(/\bSMS\b/g, map.SMS);
    out = out.replace(/\bDr\.?\b/g, map.Dr);
    out = out.replace(/\bHarley\b/g, map.Harley);
    out = out.replace(/\bAM\b/g, map.AM);
    out = out.replace(/\bPM\b/g, map.PM);
  }
  if (language === 'fr') {
    out = out.replace(/\bDr\.?\b/g, 'docteur');
    out = out.replace(/\bWhatsApp\b/gi, 'ouatssap');
  }
  out = out.replace(/[—–]/g, ', ');
  out = out.replace(/[’]/g, "'");
  return out.trim();
}

function isIndianLang(language) {
  return ['ta', 'te', 'kn', 'hi'].includes(language);
}

module.exports = { prepareSpeechText, isIndianLang };
