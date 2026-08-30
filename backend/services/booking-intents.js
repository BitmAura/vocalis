/**
 * Cancel / reschedule intent detection and confirmation helpers.
 */

const CANCEL_PATTERNS = [
  /\bcancel(l)?(ed|ing)?\s+(my\s+)?(the\s+)?appointment\b/i,
  /\bcancel(l)?(ed|ing)?\s+(my\s+)?booking\b/i,
  /\bi\s+(want|need)\s+to\s+cancel\b/i,
  /\bdon'?t\s+want\s+(the\s+)?appointment\b/i,
  /\bappointment\s+cancel\b/i,
  /रद्द\s+कर/,
  /अपॉइंटमेंट\s+रद्द/,
  /అపాయింట్‌మెంట్\s+క్యాన్సల్/,
  /appointment\s+cancel\s+pannanum/i,
  /appointment\s+cancel\s+maad(beku|la)/i,
  /अपॉointment\s+cancel/i,
  /\bcancel\s+pannunga\b/i,
  /\bcancel\s+cheyyandi\b/i,
  /\bcancel\s+maadi\b/i
];

const RESCHEDULE_PATTERNS = [
  /\breschedul(e|ing|ed)\b/i,
  /\bchange\s+(my\s+)?(the\s+)?(appointment|slot|time)\b/i,
  /\bmove\s+(my\s+)?appointment\b/i,
  /\bpostpone\b/i,
  /\banother\s+time\b/i,
  /\bdifferent\s+time\b/i,
  /\bshift\s+(my\s+)?appointment\b/i,
  /समय\s+बदल/,
  /appointment\s+change/i,
  /appointment\s+move/i,
  /slot\s+change/i,
  /மாற்ற/i,
  /reschedule\s+pannanum/i,
  /time\s+change\s+cheyyali/i
];

const AFFIRMATIVE = [
  /^yes\b/i, /^yeah\b/i, /^yep\b/i, /^ok\b/i, /^okay\b/i, /^sure\b/i, /^please\b/i,
  /^haan\b/i, /^ha\b/i, /^ji\b/i, /^bilkul\b/i, /^theek\s+hai\b/i,
  /^sari\b/i, /^aadhu\b/i, /^avunu\b/i, /^howdu\b/i,
  /हाँ/, /हां/, /जी\s+हाँ/, /ठीक\s+है/,
  /ஆம்/, /சரி/,
  /అవును/, /సరే/,
  /ಹೌದು/, /ಸರಿ/
];

const NEGATIVE = [
  /^no\b/i, /^nope\b/i, /^nah\b/i, /^don'?t\b/i, /^cancel\s+that\b/i,
  /^mat\b/i, /^nahi\b/i, /नहीं/, /వద్దు/, /ಬೇಡ/
];

function isCancelIntent(text) {
  if (!text) return false;
  const t = String(text).trim();
  if (isRescheduleIntent(t)) return false;
  return CANCEL_PATTERNS.some((re) => re.test(t));
}

function isRescheduleIntent(text) {
  if (!text) return false;
  return RESCHEDULE_PATTERNS.some((re) => re.test(String(text)));
}

function isAffirmative(text) {
  if (!text) return false;
  const t = String(text).trim();
  return AFFIRMATIVE.some((re) => re.test(t));
}

function isNegative(text) {
  if (!text) return false;
  const t = String(text).trim();
  return NEGATIVE.some((re) => re.test(t));
}

function isCancelledReply(reply) {
  if (!reply) return false;
  const low = reply.toLowerCase();
  if (low.includes('shall i cancel') || low.includes('cancel karoon')) return false;
  return (
    low.includes('has been cancelled') ||
    low.includes('has been canceled') ||
    low.includes('appointment cancelled') ||
    low.includes('appointment canceled') ||
    low.includes('cancelled your') ||
    low.includes('canceled your') ||
    reply.includes('रद्द') ||
    reply.includes('cancel aagide') ||
    reply.includes('cancel ayyindi') ||
    reply.includes('cancel panniten')
  );
}

function isRescheduledReply(reply) {
  if (!reply) return false;
  const low = reply.toLowerCase();
  if (low.includes('what new time') || low.includes('new time works')) return false;
  return (
    low.includes('has been rescheduled') ||
    low.includes('has been moved') ||
    low.includes('moved to') ||
    low.includes('rescheduled to') ||
    reply.includes('ಮಾರ್ಪಡಿಸ') ||
    reply.includes('reschedule') && (low.includes('confirmed') || low.includes('done'))
  );
}

function cancelConfirmReply(lang, slotTime) {
  const table = {
    hi: `Aapki appointment ${slotTime} par hai. Kya main ise cancel kar doon?`,
    kn: `Nimma appointment ${slotTime} ge ide. Cancel maadona?`,
    te: `Mee appointment ${slotTime} ki undi. Cancel cheyyala?`,
    ta: `Unga appointment ${slotTime} ku irukku. Cancel pannalaama?`,
    'en-IN': `Your appointment is on ${slotTime}. Shall I cancel it?`,
    'en-GB': `Your appointment is on ${slotTime}. Shall I cancel it?`,
    'en-US': `Your appointment is on ${slotTime}. Should I cancel it?`
  };
  return table[lang] || table['en-IN'];
}

function cancelDoneReply(lang, slotTime) {
  const table = {
    hi: `Theek hai — aapki ${slotTime} wali appointment cancel ho gayi. SMS bhej diya hai.`,
    kn: `Sari — ${slotTime} appointment cancel aagide. SMS kaluhisidivi.`,
    te: `Sare — ${slotTime} appointment cancel ayyindi. SMS pampinchaam.`,
    ta: `Sari — ${slotTime} appointment cancel aayiduchu. SMS anuppirom.`,
    'en-IN': `Done — your ${slotTime} appointment is cancelled. I've sent you an SMS.`,
    'en-GB': `Done — your ${slotTime} appointment is cancelled. Confirmation SMS sent.`,
    'en-US': `Done — your ${slotTime} appointment is cancelled. SMS confirmation sent.`
  };
  return table[lang] || table['en-IN'];
}

function rescheduleAskReply(lang, slotTime) {
  const table = {
    hi: `Aapki appointment ${slotTime} par hai. Naya time kya suit karega?`,
    kn: `Nimma appointment ${slotTime} ge ide. Hosada time yavudu?`,
    te: `Mee appointment ${slotTime} ki undi. Kotta time enti?`,
    ta: `Unga appointment ${slotTime} ku irukku. Puthiya time enna?`,
    'en-IN': `Your appointment is on ${slotTime}. What new time works for you?`,
    'en-GB': `Your appointment is on ${slotTime}. What new time would you like?`,
    'en-US': `Your appointment is on ${slotTime}. What new time works?`
  };
  return table[lang] || table['en-IN'];
}

function rescheduleDoneReply(lang, oldSlot, newSlot) {
  const table = {
    hi: `Done — appointment ${oldSlot} se ${newSlot} par move ho gayi. SMS bhej diya.`,
    kn: `${oldSlot} inda ${newSlot} ge appointment move maadidivi. SMS kaluhisidivi.`,
    te: `${oldSlot} nundi ${newSlot} ki move chesaam. SMS pampinchaam.`,
    ta: `${oldSlot} irundhu ${newSlot} ku move panniyachu. SMS anuppirom.`,
    'en-IN': `Done — moved from ${oldSlot} to ${newSlot}. SMS confirmation sent.`,
    'en-GB': `Done — rescheduled from ${oldSlot} to ${newSlot}. SMS sent.`,
    'en-US': `Done — moved from ${oldSlot} to ${newSlot}. SMS sent.`
  };
  return table[lang] || table['en-IN'];
}

function noBookingReply(lang) {
  const table = {
    hi: 'Is number par koi upcoming appointment nahi mila. Kya aap naya slot book karna chahenge?',
    kn: 'I number ge upcoming appointment illa. Hosada slot book maadona?',
    te: 'Ee number ki upcoming appointment ledu. Kotta slot book cheyyala?',
    ta: 'Intha number la upcoming appointment illa. Puthiya slot book pannalaama?',
    'en-IN': 'I could not find an upcoming appointment on this number. Would you like to book a new slot?',
    'en-GB': 'I could not find an upcoming appointment on this number. Shall I book a new one?',
    'en-US': 'No upcoming appointment found on this number. Want to book a new slot?'
  };
  return table[lang] || table['en-IN'];
}

module.exports = {
  isCancelIntent,
  isRescheduleIntent,
  isAffirmative,
  isNegative,
  isCancelledReply,
  isRescheduledReply,
  cancelConfirmReply,
  cancelDoneReply,
  rescheduleAskReply,
  rescheduleDoneReply,
  noBookingReply
};
