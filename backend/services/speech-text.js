/**
 * Vocalis AI — Spoken Phonetic Normalization Engine
 * Converts abbreviations, English clinic terms, and numbers into native phonetic script
 * so neural voices pronounce them with 100% natural conversational warmth.
 */
const PHONETIC_MAP = {
  ta: {
    WhatsApp: 'வாட்ஸ்ஆப்',
    SMS: 'எஸ் எம் எஸ்',
    AM: 'காலை',
    PM: 'மதியம்',
    Dr: 'டாக்டர்',
    Harley: 'ஹார்லி',
    Doctor: 'டாக்டர்',
    slot: 'ஸ்லாட்',
    appointment: 'அப்பாயின்ட்மென்ட்',
    confirm: 'கன்ஃபர்ಮ್',
    Sir: '',
    Madam: 'மேடம்'
  },
  te: {
    WhatsApp: 'వాట్సాప్',
    SMS: 'ఎస్ ఎం ఎస్',
    AM: 'ఉదయం',
    PM: 'మధ్యాహ్నం',
    Dr: 'డాక్టర్',
    Harley: 'హార్లే',
    Doctor: 'డాక్టర్',
    slot: 'స్లాట్',
    appointment: 'అపాయింట్‌మెంట్',
    confirm: 'కన్ఫర్మ్',
    Sir: 'గారు',
    Madam: 'మేడమ్'
  },
  kn: {
    WhatsApp: 'ವಾಟ್ಸಾಪ್',
    SMS: 'ಎಸ್ ಎಂ ಎಸ್',
    AM: 'ಬೆಳಿಗ್ಗೆ',
    PM: 'ಮಧ್ಯಾಹ್ನ',
    Dr: 'ಡಾಕ್ಟರ್',
    Harley: 'ಹಾರ್ಲೆ',
    Doctor: 'ಡಾಕ್ಟರ್',
    slot: 'ಸ್ಲಾಟ್',
    appointment: 'ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್',
    confirm: 'ಕನ್ಫರ್ಮ್',
    Sir: 'ಅವರೇ',
    Madam: 'ಮೇಡಂ'
  },
  hi: {
    WhatsApp: 'व्हाट्सऐप',
    SMS: 'एस एम एस',
    AM: 'सुबह',
    PM: 'दोपहर',
    Dr: 'डॉक्टर',
    Harley: 'हार्ले',
    Doctor: 'डॉक्टर',
    slot: 'स्लॉट',
    appointment: 'अपॉइंटमेंट',
    confirm: 'कन्फर्म',
    Sir: 'जी',
    Madam: 'मैम'
  },
  ml: {
    WhatsApp: 'വാട്സാപ്പ്',
    SMS: 'എസ് എം എസ്',
    AM: 'രാവിലെ',
    PM: 'ഉച്ചയ്ക്ക്',
    Dr: 'ഡോക്ടർ',
    Harley: 'ഹാർലി',
    Doctor: 'ഡോക്ടർ',
    slot: 'സ്ലോട്ട്',
    appointment: 'അപ്പോയിന്റ്മെന്റ്',
    confirm: 'കൺഫേം'
  },
  mr: {
    WhatsApp: 'व्हॉट्सअ‍ॅप',
    SMS: 'एस एम एस',
    AM: 'सकाळी',
    PM: 'दुपारी',
    Dr: 'डॉक्टर',
    Harley: 'हार्ले',
    Doctor: 'डॉक्टर',
    slot: 'स्लॉट',
    appointment: 'अपॉइंटमेंट',
    confirm: 'कन्फर्म'
  },
  gu: {
    WhatsApp: 'વ્હોટ્સએપ',
    SMS: 'એસ એમ એસ',
    AM: 'સવારે',
    PM: 'બપોરે',
    Dr: 'ડૉક્ટર',
    Harley: 'હાર્લે',
    Doctor: 'ડૉક્ટર',
    slot: 'સ્લોટ',
    appointment: 'અપોઇન્ટમેન્ટ',
    confirm: 'કન્ફર્મ'
  },
  bn: {
    WhatsApp: 'হোয়াটসঅ্যাপ',
    SMS: 'এস এম এস',
    AM: 'সকাল',
    PM: 'দুপুর',
    Dr: 'ডক্টর',
    Harley: 'হার্লে',
    Doctor: 'ডক্টর',
    slot: 'স্লট',
    appointment: 'অ্যাপয়েন্টমেন্ট',
    confirm: 'কনফার্ম'
  },
  pa: {
    WhatsApp: 'ਵਟਸਐਪ',
    SMS: 'ਐਸ ਐਮ ਐਸ',
    AM: 'ਸਵੇਰੇ',
    PM: 'ਦੁਪਹਿਰ',
    Dr: 'ਡਾਕਟਰ',
    Harley: 'ਹਾਰਲੇ',
    Doctor: 'ਡਾਕਟਰ',
    slot: 'ਸਲਾਟ',
    appointment: 'ਅਪਾਇੰਟਮੈਂਟ',
    confirm: 'ਕਨਫਰਮ'
  },
  ar: {
    WhatsApp: 'واتساب',
    SMS: 'إس إم إس',
    Dr: 'الدكتور',
    Harley: 'هارلي'
  }
};

function prepareSpeechText(text, language) {
  if (!text) return '';
  let out = String(text).replace(/[*_#`]/g, '');
  const lang = language === 'en-IN' ? 'en-IN' : language;
  const map = PHONETIC_MAP[lang];
  if (map) {
    for (const [k, v] of Object.entries(map)) {
      const reg = new RegExp('\\b' + k + '\\b', 'gi');
      out = out.replace(reg, v);
    }
  }
  
  if (language === 'fr') {
    out = out.replace(/\bDr\.?\b/g, 'docteur');
    out = out.replace(/\bWhatsApp\b/gi, 'ouatssap');
  }
  
  out = out.replace(/[—–]/g, ', ');
  out = out.replace(/[’]/g, "'");
  // Clean double spaces
  out = out.replace(/\s+/g, ' ');
  return out.trim();
}

function isIndianLang(language) {
  return ['ta', 'te', 'kn', 'hi', 'ml', 'mr', 'gu', 'bn', 'pa'].includes(language);
}

module.exports = { prepareSpeechText, isIndianLang };
