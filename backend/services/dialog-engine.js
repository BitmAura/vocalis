const { isUrgentBooking } = require('./emergency-gate');

const NAME_CHARS =
  '[A-Za-z\\u0C80-\\u0CFF\\u0900-\\u097F\\u0C00-\\u0C7F\\u0B80-\\u0BFF\\u0600-\\u06FF]';

const SUPPORTED_LANGUAGES = ['kn', 'hi', 'te', 'ta', 'ar', 'fr', 'en-GB', 'en-US', 'en-IN'];

let offlineMode = false;
function setOfflineMode(value) {
  offlineMode = !!value;
}
function isOfflineMode() {
  return (
    offlineMode ||
    process.env.VOCALIS_SKIP_LLM === '1' ||
    process.env.VOCALIS_SKIP_LLM === 'true'
  );
}

function normalizeLanguage(code) {
  if (!code) return 'en-GB';
  const c = String(code).trim();
  const map = {
    'ta-IN': 'ta',
    'kn-IN': 'kn',
    'hi-IN': 'hi',
    'te-IN': 'te',
    'ar-SA': 'ar',
    'ar-AE': 'ar',
    'fr-FR': 'fr',
    french: 'fr',
    en: 'en-GB',
    'en-UK': 'en-GB'
  };
  const mapped = map[c] || c;
  return SUPPORTED_LANGUAGES.includes(mapped) ? mapped : 'en-GB';
}

function detectScriptLanguage(text) {
  if (!text) return null;
  if (/[\u0B80-\u0BFF]/.test(text)) return 'ta';
  if (/[\u0C00-\u0C7F]/.test(text)) return 'te';
  if (/[\u0C80-\u0CFF]/.test(text)) return 'kn';
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  return null;
}

function resolveLanguage(message, requested) {
  return detectScriptLanguage(message) || normalizeLanguage(requested);
}

function pick(lang, table) {
  return table[lang] || table['en-GB'] || Object.values(table)[0];
}

function lastAiText(history) {
  if (!history || !history.length) return '';
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'ai' && history[i].text) return history[i].text;
  }
  return '';
}

function quoteFromServices(config) {
  const list = config.services;
  if (!list || !list.length) return null;
  return list.slice(0, 3).map((s) => `${s.name}: ${s.fee}`).join('. ');
}

function alreadyTalking(history) {
  return !!(history && history.some((t) => t.role === 'ai'));
}

function aiWaitingForConfirm(history) {
  const t = lastAiText(history).toLowerCase();
  if (!t) return false;
  return (
    t.includes('shall i book') ||
    t.includes('does that work') ||
    t.includes('lock that') ||
    t.includes('book it?') ||
    t.includes('okay with') ||
    t.includes('போட்டு வைக்கலாமா') ||
    t.includes('வைக்கலாமா') ||
    t.includes('ಬುಕ್ ಮಾಡೋಣಾ') ||
    t.includes('बुक कर दूँ') ||
    t.includes('బుక్ చేయనా') ||
    t.includes('أحجز') ||
    t.includes('je réserve') ||
    t.includes('je reserve') ||
    t.includes('on réserve')
  );
}

function isSoftYes(low) {
  const p = low.replace(/[.,!]/g, '').trim();
  return (
    ['yes', 'yeah', 'yep', 'ok', 'okay', 'sure', 'please', 'go ahead', 'do it', 'correct', 'right'].includes(p) ||
    p === 'हाँ' ||
    p === 'हां' ||
    p === 'ಸರಿ' ||
    p === 'ಹೌದು' ||
    p === 'అవును' ||
    p === 'సరే' ||
    p === 'ஆம்' ||
    p === 'சரி' ||
    p === 'نعم' ||
    p === 'ايوه' ||
    p === 'oui' ||
    p === 'ouais' ||
    p === "d'accord" ||
    p === 'volontiers' ||
    low.includes('yes please') ||
    low.includes('that works') ||
    low.includes('go ahead')
  );
}

function isSoftNo(low) {
  return (
    low === 'no' ||
    low.startsWith('no ') ||
    low.includes('not that') ||
    low.includes('different') ||
    low.includes('change') ||
    low.includes('வேற') ||
    low.includes('ಬೇಡ') ||
    low.includes('नहीं') ||
    low.includes('వద్దు') ||
    low.includes('لا')
  );
}

function isBookingIntent(low) {
  return (
    low.includes('appointment') ||
    low.includes('appoinment') ||
    low.includes('apartment') ||
    low.includes('aptment') ||
    low.includes('book') ||
    low.includes('slot') ||
    low.includes('available') ||
    low.includes('visit') ||
    low.includes('reserve') ||
    low.includes('அப்பாயின்ட்') ||
    low.includes('முன்பதிவு') ||
    low.includes('ಅಪಾಯಿಂಟ್') ||
    low.includes('अपॉइंट') ||
    low.includes('అపాయింట్') ||
    low.includes('موعد') ||
    low.includes('rendez-vous') ||
    low.includes('réserver') ||
    low.includes('reserver') ||
    low.includes('table') ||
    low.includes('reservation') ||
    low.includes('dispatch') ||
    low.includes('consult') ||
    low.includes('site visit') ||
    low.includes('farmland')
  );
}

function processTurn({ message, language, industry, history, personaName, bizName, ownerName, address, workingHours, requestedSlot, callerName, services }) {
  const hist = history || [];
  const lang = resolveLanguage(message, language);
  const parsed = parseRequestedSlot(message, hist);
  const config = {
    language: lang,
    industry: industry || 'dental',
    personaName: personaName || 'Clara',
    bizName: bizName || 'Kumar's Microscopic Dental Care',
    ownerName: ownerName || 'Dr. Prem',
    address: address || 'Kumar\'s Microscopic Dental Care, Indiranagar, Bangalore',
    workingHours: workingHours || 'Mon-Sat: 8:30 AM - 6:00 PM',
    requestedSlot: requestedSlot || parsed,
    callerName: callerName || extractCallerName(message, hist),
    services: services || []
  };
  const reply = routeAndGenerateReply(message, config, hist);
  return {
    reply,
    language: lang,
    callerName: config.callerName,
    requestedSlot: config.requestedSlot,
    isBookingConfirm: isConfirmedBookingReply(reply) && !!config.callerName
  };
}

function routeAndGenerateReply(message, config, history) {
  const low = message.toLowerCase().trim();
  const lang = normalizeLanguage(config.language);
  const slot = config.requestedSlot;
  const name = config.callerName;
  const biz = config.bizName;
  const persona = config.personaName;
  const owner = config.ownerName;
  const industry = config.industry || 'dental';
  const talking = alreadyTalking(history);

  if (isFarewell(low)) {
    return pick(lang, {
      kn: 'ಸರಿ, ನಂತರ ಮಾತಾಡೋಣ. ಬಾಯ್.',
      hi: 'ठीक है, बाद में बात करते हैं। बाय।',
      te: 'సరే, తర్వాత మాట్లాడుదాం. బై.',
      ta: 'சரி, பிறகு பேசுவோம். போய் வாங்க.',
      ar: 'تمام، مع السلامة.',
      fr: "D'accord, a bientot. Au revoir.",
      'en-US': 'Alright, speak soon. Bye.',
      'en-GB': 'Alright, speak soon. Bye.'
    });
  }

  if (isGreetingOnly(low)) {
    if (talking) {
      return pick(lang, {
        kn: 'ಹಾಂ, ಹೇಳಿ?',
        hi: 'हाँ, बोलिए?',
        te: 'చెప్పండి?',
        ta: 'சொல்லுங்க?',
        ar: 'تفضل، هلا.',
        fr: "Oui, je suis la. Dites-moi.",
        'en-US': "Yep, I'm here. What did you need?",
        'en-GB': "Yep, I'm here. What did you need?"
      });
    }
    return pick(lang, {
      kn: `ನಮಸ್ಕಾರ, ${persona} — ${biz}. ಹೇಗೆ ಸಹಾಯ?`,
      hi: `नमस्ते, मैं ${persona} हूँ, ${biz}। कैसे मदद करूँ?`,
      te: `హాయ్, ${persona} — ${biz}. ఎలా సాయం?`,
      ta: `வணக்கம், நான் ${persona}, ${biz}. என்ன வேணும்?`,
      ar: `هلا، معك ${persona} من ${biz}. كيف اقدر اساعد؟`,
      fr: `Bonjour, c'est ${persona} a ${biz}. Je vous ecoute.`,
      'en-IN': `Hi, ${persona} at ${biz}. How can I help?`,
      'en-US': `Hi, this is ${persona} at ${biz}. How can I help?`,
      'en-GB': `Hi, ${persona} at ${biz}. How can I help?`
    });
  }

  // Two-way close: they already heard the readback — only NOW lock
  if (name && slot && aiWaitingForConfirm(history) && isSoftYes(low)) {
    return lockReply(lang, name, slot, owner);
  }

  if (aiWaitingForConfirm(history) && isSoftNo(low)) {
    return pick(lang, {
      kn: 'ಸರಿ — ಯಾವ ದಿನ, ಎಷ್ಟು ಗಂಟೆ ಬೇಕು?',
      hi: 'ठीक है — कौन सा दिन और समय चाहिए?',
      te: 'సరే — ఏ రోజు, ఎంత సమయం?',
      ta: 'சரி — எந்த நாள், எந்த நேரம்?',
      ar: 'تمام — أي يوم وأي وقت؟',
      fr: 'Pas de souci. Quel jour et quelle heure?',
      'en-GB': 'No problem — which day and time works better?'
    });
  }

  // They just gave a name: read it back, wait. Do not dump SMS/WhatsApp.
  const justGaveName = !!(extractCallerName(message, history) && lastAiText(history));
  if (name && justGaveName && !aiWaitingForConfirm(history) && !isSoftYes(low)) {
    if (!slot) {
      return pick(lang, {
        kn: `ಸರಿ ${name}. ಯಾವ ದಿನ ಬೇಕು?`,
        hi: `ठीक ${name}. कौन सा दिन चाहिए?`,
        te: `సరే ${name}. ఏ రోజు?`,
        ta: `சரி ${name}. எந்த நாள்?`,
        ar: `حسنًا ${name}. أي يوم؟`,
        fr: `C'est note, ${name}. Quel jour et quelle heure?`,
        'en-GB': `Got it, ${name}. What day and time works?`
      });
    }
    return readbackReply(lang, name, slot, owner);
  }

  if (isAddressInquiry(low)) {
    if (industry === 'realestate') {
      return pick(lang, {
        kn: `ನಮ್ಮ ಪ್ರಾಜೆಕ್ಟ್ ${config.address} ನಲ್ಲಿದೆ. ಉಚಿತ ಪಾರ್ಕಿಂಗ್ ಮತ್ತು ಕ್ಲಬ್‌ಹೌಸ್ ಇದೆ. ಗೂಗಲ್ ಮ್ಯಾಪ್ ಪಿನ್ ಕಳುಹಿಸಬೇಕಾ?`,
        hi: `हमारा प्रोजेक्ट ${config.address} पर है। क्या मैं गूगल मैप पिन भेज दूँ?`,
        te: `మా ప్రాజెక్ట్ ${config.address} వద్ద ఉంది. లొకేషన్ పిన్ పంపనా?`,
        ta: `எங்கள் திட்டம் ${config.address} இல் உள்ளது. மேப் பின் அனுப்பட்டுமா?`,
        ar: `المشروع في ${config.address}. أرسل لكم موقع الخريطة؟`,
        fr: `Le projet est à ${config.address}. Je vous envoie l’épingle carte ?`,
        'en-GB': `Project is at ${config.address}. Want the map pin?`
      });
    }
    return pick(lang, {
      kn: `ವಿಳಾಸ ${config.address}. ಸಮಯ ${config.workingHours}.`,
      hi: `पता ${config.address}. समय ${config.workingHours}.`,
      te: `చిరునామా ${config.address}.`,
      ta: `முகவரி ${config.address}.`,
      ar: `العنوان ${config.address}.`,
      fr: `Nous sommes au ${config.address}. Horaires ${config.workingHours}. Autre chose ?`,
      'en-GB': `We're at ${config.address}. Hours ${config.workingHours}. Need anything else on that?`
    });
  }

  if (isPricingInquiry(low)) {
    const live = quoteFromServices(config);
    if (live) {
      return pick(lang, {
        kn: `${live}. ಬುಕ್ ಮಾಡೋಣಾ?`,
        hi: `${live}. आगे बढ़ें?`,
        te: `${live}. బుక్ చేయనా?`,
        ta: `${live}. போடலாமா?`,
        ar: `${live}. نكمل؟`,
        fr: `${live}. On continue ?`,
        'en-US': `${live}. Want to go ahead?`,
        'en-GB': `${live}. Want to go ahead?`
      });
    }
    if (industry === 'realestate') {
      return pick(lang, {
        kn: `ಕಾಲು ಎಕರೆ ₹25 ಲಕ್ಷ, ಅರ್ಧ ₹48, ಒಂದು ₹90. ಸೈಟ್ ನೋಡಬೇಕಾ?`,
        hi: `क्वार्टर एकड़ ₹25 लाख, आधा ₹48, एक ₹90. विजिट चाहिए?`,
        te: `పావు ఎకరం ₹25 లక్షలు. సైట్ కావాలా?`,
        ta: `கால் ஏக்கர் ₹25 லட்சம். சைட் பாக்கலாமா?`,
        ar: `ربع فدان من ٢٥ لكح. زيارة؟`,
        fr: `Quart d’acre dès ₹25L, demi ₹48L, un acre ₹90L. Visite du site ?`,
        'en-GB': `Quarter-acre from ₹25L, half ₹48L, one acre ₹90L. Want a site visit?`
      });
    }
    if (industry === 'hvac') {
      return pick(lang, {
        'en-US': `Diagnostic is $79, waived if we repair. Want someone out today?`,
        fr: `Diagnostic 79 $, offert si on répare. Quelqu’un aujourd’hui ?`,
        'en-GB': `Diagnostic is $79, waived if we repair. Want someone out today?`
      });
    }
    if (industry === 'legal') {
      return pick(lang, {
        'en-US': `No fee unless we win. Want a free consult?`,
        fr: `Pas d’honoraires sauf si on gagne. Consultation gratuite ?`,
        'en-GB': `No fee unless we win. Want a free consult?`
      });
    }
    if (industry === 'restaurant') {
      return pick(lang, {
        fr: `Les tables sont gratuites. Menu dégustation 85 £. Combien de personnes ?`,
        'en-GB': `Tables are free to book. Tasting menu is £85. How many people?`
      });
    }
    return pick(lang, {
      kn: `ಕ್ಲೀನಿಂಗ್/ಚೆಕಪ್ £140. ಟೈಮ್ ನೋಡೋಣಾ?`,
      hi: `क्लीनिंग/चेकअप £140. टाइम देखें?`,
      te: `క్లీనింగ్ £140. టైమ్ చూద్దామా?`,
      ta: `சுத்தம் £140. நேரம் பார்க்கலாமா?`,
      ar: `التنظيف ١٤٠ جنيه. نحدد وقت؟`,
      fr: `Hygiène 140 £, contrôle 95 £. Je regarde les créneaux ?`,
      'en-GB': `Hygiene is £140, checkup £95. Want me to look at times?`
    });
  }

  if (isTimepassOrCasual(low)) {
    if (industry === 'realestate') {
      return pick(lang, {
        kn: `ನಾನು ${persona}, ${biz}. ನಾವು ಗೇಟೆಡ್ ಮ್ಯಾನೇಜ್ಡ್ ಫಾರ್ಮ್‌ಲ್ಯಾಂಡ್ ಮಾರಾಟ ಮಾಡುತ್ತೇವೆ. ಹೂಡಿಕೆಯಾ ಅಥವಾ ಫಾರ್ಮ್‌ಹೌಸ್‌ಗಾ?`,
        hi: `मैं ${persona}, ${biz} से। हम गेटेड फार्मलैंड देते हैं। निवेश या फार्महाउस?`,
        te: `నేను ${persona}, ${biz}. ఫార్మ్‌ల్యాండ్ కావాలా సార్?`,
        ta: `நான் ${persona}, ${biz}. பண்ணை நிலம் பார்க்கிறீர்களா?`,
        ar: `أنا ${persona} من ${biz}. أراضي زراعية مدارة. استثمار أم استراحة؟`,
        fr: `Je suis ${persona} chez ${biz}. Investissement terrain, ou maison de ferme ?`,
        'en-GB': `I'm ${persona} at ${biz}. Looking at land to invest, or a farmhouse?`
      });
    }
    return pick(lang, {
      kn: `ನಾನು ${persona}, ${biz}. ನಾವು ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಮತ್ತು ಸೇವೆಗಳಿಗೆ ಸಹಾಯ ಮಾಡುತ್ತೇವೆ. ಬುಕ್ ಮಾಡಬೇಕಾ?`,
      hi: `मैं ${persona}, ${biz}। क्या अपॉइंटमेंट बुक करना है?`,
      te: `నేను ${persona}, ${biz}. అపాయింట్‌మెంట్ కావాలా?`,
      ta: `நான் ${persona}, ${biz}. அப்பாயின்ட்மென்ட் வேண்டுமா?`,
      ar: `أنا ${persona} من ${biz}. تريد حجز موعد؟`,
      fr: `Je suis ${persona} chez ${biz}. Un rendez-vous, ou une question ?`,
      'en-GB': `I'm ${persona} at ${biz}. Booking, or a question?`
    });
  }

  if (isDoctorInquiry(low)) {
    return pick(lang, {
      kn: `${owner} 15+ ವರ್ಷ. ನೋಡಬೇಕಾ?`,
      hi: `${owner} 15+ वर्ष। मिलना है?`,
      te: `${owner} 15+ ఏళ్లు. కలవాలా?`,
      ta: `${owner} 15+ ஆண்டு. பாக்கணுமா?`,
      ar: `${owner} خبرة أكثر من ١٥ سنة. تريد مقابلته؟`,
      fr: `${owner} a plus de 15 ans d’expérience. Vous voulez le voir ?`,
      'en-GB': `${owner} has 15+ years. Want to see them?`
    });
  }

  if (isUrgentBooking(message) || isUrgentBooking(low)) {
    return pick(lang, {
      kn: 'ಕ್ಷಮಿಸಿ. ಹೆಸರು ಹೇಳಿ, ಇವತ್ತೇ ನೋಡ್ತೀವಿ.',
      hi: 'माफ़ कीजिए. नाम बताइए, आज ही देखते हैं.',
      te: 'క్షమించండి. పేరు చెప్పండి, ఈరోజే చూస్తాం.',
      ta: 'வலிக்கு வருத்தம். பெயர் சொல்லுங்க, இன்றே பாக்கலாம்.',
      ar: 'آسف على الألم. اسمكم؟ نحاول اليوم.',
      'en-US': "Sorry you're hurting. What's your name?",
      fr: 'Désolé pour la douleur. Votre nom ?',
      'en-GB': "Sorry you're in pain. What's your name?"
    });
  }

  if (isBookingIntent(low) || slot) {
    if (slot && !name) {
      return pick(lang, {
        kn: `${slot} ಸಿಗುತ್ತೆ. ಹೆಸರು?`,
        hi: `${slot} मिल सकता है। नाम?`,
        te: `${slot} ఉంది. పేరు?`,
        ta: `${slot} முடியும். பெயர்?`,
        ar: `${slot} موجود. الاسم من فضلك؟`,
        fr: `${slot} est libre. Le nom pour reserver ?`,
        'en-US': `${slot} is free. What name shall I put?`,
        'en-GB': `${slot} is free. What name shall I put?`
      });
    }
    if (!slot) {
      return pick(lang, {
        kn: 'ಸರಿ — ಬೆಳಿಗ್ಗೆ ಅಥವಾ ಮಧ್ಯಾಹ್ನ?',
        hi: 'ठीक — सुबह या दोपहर?',
        te: 'సరే — ఉదయమా సాయంత్రమా?',
        ta: 'சரி — காலையா மாலையா?',
        ar: 'تمام، صباح ولا عصر؟',
        fr: "D'accord. Matin ou apres-midi ?",
        'en-US': 'Sure. Morning or afternoon?',
        'en-GB': 'Sure. Morning or afternoon?'
      });
    }
  }

  return pick(lang, {
    kn: 'ಹೇಳಿ, ನಾನು ಕೇಳ್ತಿದ್ದೀನಿ.',
    hi: 'बोलिए, मैं सुन रही हूँ.',
    te: 'చెప్పండి, వింటున్నాను.',
    ta: 'சொல்லுங்க, கேட்டுக்கிட்டு இருக்கேன்.',
    ar: 'تفضل، اسمعك.',
    fr: "Je vous ecoute. Dites-moi.",
    'en-US': "I'm listening. What do you need?",
    'en-GB': "I'm listening. What do you need?"
  });
}

function readbackReply(lang, name, slot, owner) {
  return pick(lang, {
    kn: `${name}, ${slot}, ${owner} — ಬುಕ್ ಮಾಡೋಣಾ?`,
    hi: `${name}, ${slot}, ${owner} — बुक कर दूँ?`,
    te: `${name}, ${slot}, ${owner} — బుక్ చేయనా?`,
    ta: `${name}, ${slot} — போட்டு வைக்கலாமா?`,
    ar: `${name}، ${slot} مع ${owner}. احجز لك؟`,
    fr: `${name}, ${slot} avec ${owner}. Je reserve ?`,
    'en-US': `${name}, ${slot} with ${owner}. Shall I book it?`,
    'en-GB': `${name}, ${slot} with ${owner}. Shall I book it?`
  });
}

function lockReply(lang, name, slot, owner) {
  return pick(lang, {
    kn: `ಬುಕ್ ಆಯ್ತು ${name}. ${slot}. ನಂತರ ಸಿಗೋಣ.`,
    hi: `बुक हो गया ${name}. ${slot}. मिलते हैं.`,
    te: `బుక్ అయ్యింది ${name}. ${slot}. తర్వాత కలుద్దాం.`,
    ta: `வைத்துட்டேன் ${name}. ${slot} உறுதியானது. சந்திப்போம்.`,
    ar: `تم الحجز ${name}. ${slot} مؤكد. نراك.`,
    fr: `C'est reserve, ${name}. ${slot} est confirme. A bientot.`,
    'en-US': `Booked, ${name}. ${slot} is locked in. See you then.`,
    'en-GB': `Booked, ${name}. ${slot} is locked in. See you then.`
  });
}

function isConfirmedBookingReply(reply) {
  if (!reply) return false;
  const low = reply.toLowerCase();
  if (low.includes('shall i book') || low.includes('shall i lock') || low.includes('போட்டு வைக்கலாமா') || low.includes('ಬುಕ್ ಮಾಡೋಣಾ') || low.includes('je réserve ?')) {
    return false;
  }
  return (
    low.includes('booked') ||
    low.includes('locked in') ||
    low.includes('confirmed') ||
    low.includes('scheduled') ||
    low.includes('تم الحجز') ||
    reply.includes('ಬುಕ್') ||
    reply.includes('ಕನ್ಫರ್ಮ್') ||
    reply.includes('ಖಚಿತ') ||
    reply.includes('ಖಾತರಿ') ||
    reply.includes('ಮಾಡಲಾಗಿದೆ') ||
    reply.includes('ಬುಕ್ಕಿಂಗ್') ||
    reply.includes('ಬುಕ್ ಆಗಿದೆ') ||
    reply.includes('बुक') ||
    reply.includes('कन्फर्म') ||
    reply.includes('बुकिंग') ||
    reply.includes('బుక్') ||
    reply.includes('ఖరారైంది') ||
    reply.includes('కన్ఫర్మ్') ||
    reply.includes('உறுதியானது') ||
    reply.includes('பதிவு') ||
    low.includes("c'est reserve") ||
    low.includes('est confirme')
  );
}

function isSalesAgreement(low) {
  return (
    low.includes('agree') ||
    low.includes('confirm') ||
    low.includes('lock it') ||
    low.includes('book it') ||
    low.includes('sounds good') ||
    low.includes('perfect') ||
    low.includes('i want to book') ||
    low.includes('ಖಚಿತ') ||
    low.includes('ಬುಕ್ ಮಾಡಿ') ||
    low.includes('कन्फर्म') ||
    low.includes('बुक करें') ||
    low.includes('చేయండి') ||
    low.includes('புக்') ||
    low.includes('أكد') ||
    low.includes('احجز') ||
    low.includes('confirmer') ||
    low.includes("d'accord pour")
  );
}

function isGreetingOnly(low) {
  const pure = low.replace(/[.,!؟]/g, '').trim();
  const greetings = [
    'hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening',
    'ಹಲೋ', 'ನಮಸ್ಕಾರ', 'ನಮಸ್ತೆ', 'नमस्ते', 'हेलो', 'నమస్కారం', 'నమస్తే', 'వందనం',
    'வணக்கம்', 'مرحبا', 'السلام عليكم', 'bonjour', 'salut', 'bonsoir', 'coucou'
  ];
  const words = pure.split(/\s+/);
  return (
    greetings.includes(pure) ||
    (greetings.some((g) => pure.startsWith(g)) &&
      words.length <= 3 &&
      !pure.includes('book') &&
      !pure.includes('price') &&
      !pure.includes('cost') &&
      !pure.includes('pain') &&
      !pure.includes('appointment'))
  );
}

function isFarewell(low) {
  return (
    low.includes('goodbye') ||
    low.includes('bye bye') ||
    low === 'bye' ||
    low.includes('talk later') ||
    low.includes("that's all") ||
    low.includes('nothing else') ||
    low.includes('போய் வா') ||
    low.includes('مع السلامة') ||
    low.includes('au revoir') ||
    low.includes('à bientôt') ||
    low.includes('a bientot')
  );
}

function isAddressInquiry(low) {
  return (
    low.includes('where') ||
    low.includes('location') ||
    low.includes('address') ||
    low.includes('how to reach') ||
    low.includes('directions') ||
    low.includes('parking') ||
    low.includes('ವಿಳಾಸ') ||
    low.includes('ಎಲ್ಲಿದೆ') ||
    low.includes('पता') ||
    low.includes('कहाँ') ||
    low.includes('లొకేషన్') ||
    low.includes('ఎక్కడ') ||
    low.includes('முகவரி') ||
    low.includes('எங்கே') ||
    low.includes('أين') ||
    low.includes('العنوان') ||
    low.includes('adresse') ||
    low.includes('où êtes') ||
    low.includes('ou etes')
  );
}

function isPricingInquiry(low) {
  return (
    low.includes('price') ||
    low.includes('cost') ||
    low.includes('fee') ||
    low.includes('how much') ||
    low.includes('rate') ||
    low.includes('charges') ||
    low.includes('ಶುಲ್ಕ') ||
    low.includes('ಬೆಲೆ') ||
    low.includes('ಎಷ್ಟು') ||
    low.includes('फीस') ||
    low.includes('कीमत') ||
    low.includes('कितना') ||
    low.includes('கட்டணம்') ||
    low.includes('எவ்வளவு') ||
    low.includes('ధర') ||
    low.includes('ఎంత') ||
    low.includes('كم') ||
    low.includes('السعر') ||
    low.includes('prix') ||
    low.includes('combien') ||
    low.includes('tarif')
  );
}

function isTimepassOrCasual(low) {
  return (
    low.includes('what do you do') ||
    low.includes('who is this') ||
    low.includes('who are you') ||
    low.includes('tell me about') ||
    low.includes('ಯಾರು ನೀವು') ||
    low.includes('कौन हो') ||
    low.includes('நீ யார்') ||
    low.includes('உங்கள் பேர்') ||
    low.includes('من أنت') ||
    low.includes('qui êtes') ||
    low.includes('qui etes') ||
    low.includes('vous faites quoi')
  );
}

function isDoctorInquiry(low) {
  if (isBookingIntent(low)) return false;
  return (
    low.includes('how many doctor') ||
    low.includes('which doctor') ||
    low.includes('experience') ||
    low.includes('qualification') ||
    (low.includes('doctor') && !low.includes('with')) ||
    low.includes('dentist') ||
    low.includes('ಡಾಕ್ಟರ್') ||
    low.includes('डॉक्टर') ||
    low.includes('டாக்டர்') ||
    low.includes('الطبيب') ||
    low.includes('docteur') ||
    low.includes('dentiste')
  );
}

function isEmergency(low) {
  return isUrgentBooking(low);
}

function parseRequestedSlot(message, history) {
  const low = message.toLowerCase();
  const sanitizedLow = low
    .replace(/\b\d+(?:\/\d+)?\s*(?:acre|acres|ಎಕರೆ|ஏக்கர்|plot|plots|person|people|bhk|lakh|lakhs|cr|crore)\b/gi, ' ')
    .trim();

  const timeMatch = sanitizedLow.match(
    /(\b\d{1,2}(?::\d{2}|\.\d{2})\s*(?:am|pm)?\b|\b\d{1,2}\s*(?:am|pm|o'clock)\b)/i
  );
  let timeStr = timeMatch ? timeMatch[1] : null;

  let dayStr = null;
  if (low.includes('tomorrow') || low.includes('ನಾಳೆ') || low.includes('कल') || low.includes('రేపు') || low.includes('நாளை') || low.includes('غدا') || low.includes('demain')) dayStr = 'Tomorrow';
  else if (low.includes('today') || low.includes('ಇವತ್ತು') || low.includes('आज') || low.includes('ఈరోజు') || low.includes('இன்று') || low.includes('اليوم') || low.includes("aujourd'hui") || low.includes('aujourdhui')) dayStr = 'Today';
  else if (low.includes('saturday') || low.includes('ಶನಿವಾರ') || low.includes('शनिवार') || low.includes('శనివారం') || low.includes('சனி') || low.includes('samedi')) dayStr = 'this Saturday';
  else if (low.includes('sunday') || low.includes('ಭಾನುವಾರ') || low.includes('रविवार') || low.includes('ఆదివారం') || low.includes('ஞாயிறு') || low.includes('dimanche')) dayStr = 'this Sunday';
  else if (low.includes('monday') || low.includes('ಸೋಮವಾರ') || low.includes('सोमवार') || low.includes('திங்கள்') || low.includes('lundi')) dayStr = 'this Monday';
  else if (low.includes('friday') || low.includes('ಶುಕ್ರವಾರ') || low.includes('शुक्रवार') || low.includes('வெள்ளி') || low.includes('vendredi')) dayStr = 'this Friday';

  if (!timeStr || !dayStr) {
    for (let i = (history || []).length - 1; i >= 0; i--) {
      const hText = (history[i].text || '').toLowerCase();
      if (!timeStr) {
        const hTime = hText.match(
          /(\b\d{1,2}(?::\d{2}|\.\d{2})\s*(?:am|pm)?\b|\b\d{1,2}\s*(?:am|pm|o'clock)\b)/i
        );
        if (hTime) timeStr = hTime[1];
      }
      if (!dayStr) {
        if (hText.includes('tomorrow') || hText.includes('ನಾಳೆ') || hText.includes('कल') || hText.includes('நாளை')) dayStr = 'Tomorrow';
        else if (hText.includes('today') || hText.includes('ಇವತ್ತು') || hText.includes('आज') || hText.includes('இன்று')) dayStr = 'Today';
        else if (hText.includes('saturday') || hText.includes('ಶನಿವಾರ') || hText.includes('சனி')) dayStr = 'this Saturday';
        else if (hText.includes('friday') || hText.includes('ಶುಕ್ರವಾರ') || hText.includes('வெள்ளி')) dayStr = 'this Friday';
      }
    }
  }

  if (dayStr && timeStr) return `${dayStr} at ${formatTime(timeStr)}`;
  if (timeStr) return `Tomorrow at ${formatTime(timeStr)}`;
  if (dayStr) return `${dayStr} at 10:00 AM`;
  return null;
}

function formatTime(t) {
  let clean = t.trim().toUpperCase();
  if (!clean.includes('AM') && !clean.includes('PM')) {
    const num = parseFloat(clean.replace(':', '.'));
    if (num >= 8 && num <= 11.59) clean += ' AM';
    else clean += ' PM';
  }
  return clean;
}

function extractCallerName(message, history) {
  const cleanMsg = message.trim();
  const stopWords = [
    'a new', 'new patient', 'an existing', 'existing patient', 'looking', 'calling',
    'trying', 'booking', 'wondering', 'hoping', 'interested', 'here to', 'want to',
    'just calling', 'someone', 'appointment', 'teeth', 'dental', 'cleaning', 'tomorrow',
    'today', 'friday', 'where', 'price'
  ];

  const nameIntroRegex = new RegExp(
    `(?:my name is|this is|call me|name is|ಹೆಸರು|ನನ್ನ ಹೆಸರು|मेरा नाम|नाम है|నా పేరు|పేరు|என் பெயர்|பெயர்|اسمي)\\s+(${NAME_CHARS}+(?:\\s+${NAME_CHARS}+)?)`,
    'i'
  );
  const match = cleanMsg.match(nameIntroRegex);
  if (match && match[1]) {
    const candidate = match[1].replace(/[.,!]/g, '').trim();
    if (!stopWords.some((sw) => candidate.toLowerCase().startsWith(sw))) return candidate;
  }

  const iAmMatch = cleanMsg.match(
    new RegExp(`\\b(?:i am|i'm|im)\\s+(${NAME_CHARS}+(?:\\s+${NAME_CHARS}+)?)`, 'i')
  );
  if (iAmMatch && iAmMatch[1]) {
    const cand = iAmMatch[1].replace(/[.,!]/g, '').trim();
    if (!stopWords.some((sw) => cand.toLowerCase().startsWith(sw))) return cand;
  }

  const lastText = lastAiText(history);
  if (askedForName(lastText)) {
    const skip = ['hi', 'hello', 'yes', 'ok', 'sure', 'yeah', 'yep', 'here', 'its', 'im'];
    const words = cleanMsg.split(/\s+/).filter((w) => !skip.includes(w.toLowerCase()));
    if (words.length >= 1 && words.length <= 3) {
      const candidate = words.join(' ').replace(/[.,!]/g, '');
      if (!stopWords.some((sw) => candidate.toLowerCase().includes(sw))) return candidate;
    }
  }

  if (history) {
    for (let i = 0; i < history.length - 1; i++) {
      if (history[i].role === 'ai' && askedForName(history[i].text) && history[i + 1].role === 'user') {
        const nxt = (history[i + 1].text || '').trim();
        const words = nxt.split(/\s+/).filter((w) => !['hi', 'hello', 'yes', 'ok'].includes(w.toLowerCase()));
        if (words.length >= 1 && words.length <= 3) {
          const c = words.join(' ').replace(/[.,!]/g, '');
          if (!stopWords.some((sw) => c.toLowerCase().includes(sw))) return c;
        }
      }
    }
    for (const turn of history) {
      if (turn.role === 'user') {
        const histMatch = turn.text.match(nameIntroRegex);
        if (histMatch && histMatch[1]) {
          const c = histMatch[1].replace(/[.,!]/g, '').trim();
          if (!stopWords.some((sw) => c.toLowerCase().startsWith(sw))) return c;
        }
      }
    }
  }

  return null;
}

function askedForName(text) {
  if (!text) return false;
  return (
    text.toLowerCase().includes('name') ||
    text.includes('ಹೆಸರು') ||
    text.includes('नाम') ||
    text.includes('పేరు') ||
    text.includes('பெயர்') ||
    text.includes('اسم') ||
    text.toLowerCase().includes('nom') ||
    text.toLowerCase().includes('prénom')
  );
}

module.exports = {
  SUPPORTED_LANGUAGES,
  setOfflineMode,
  isOfflineMode,
  normalizeLanguage,
  detectScriptLanguage,
  resolveLanguage,
  processTurn,
  routeAndGenerateReply,
  parseRequestedSlot,
  extractCallerName,
  isConfirmedBookingReply
};
