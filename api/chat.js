const https = require('https');

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  let body = req.body;
  if (!body) {
    body = await new Promise((resolve) => {
      let b = '';
      req.on('data', c => b += c);
      req.on('end', () => resolve(b));
      setTimeout(() => resolve(b), 300);
    });
  }

  let data = {};
  if (typeof body === 'object' && body !== null) {
    data = body;
  } else if (typeof body === 'string') {
    try { data = JSON.parse(body); } catch(e) {}
  }

  const message = data.message || 'Hello';
  const language = data.language || 'en-GB';
  const bizName = data.bizName || 'Harley Street Smiles Dental';
  const personaName = data.personaName || 'Clara';
  const ownerName = data.ownerName || 'Dr. Harley';
  const history = data.history || [];

  const langInstructions = {
    'kn': 'Speak ONLY in warm, natural conversational Kannada (ಕನ್ನಡ). Use honorific "ಅವರೇ".',
    'te': 'Speak ONLY in polite conversational Telugu (తెలుగు). Use honorific "గారు".',
    'ta': 'Speak ONLY in warm conversational Tamil (தமிழ்). Use honorific "அவர்களே".',
    'hi': 'Speak ONLY in polite conversational Hindi (हिन्दी). Use honorific "जी".',
    'en-GB': 'Speak in warm, professional British English (RP accent style).',
    'en-US': 'Speak in upbeat, friendly American English.',
    'en-IN': 'Speak in polite, professional Indian English.'
  };
  const langRule = langInstructions[language] || 'Speak in warm conversational English.';

  const systemPrompt = `You are ${personaName}, senior receptionist at ${bizName}.
Owner: ${ownerName}.
Language Rule: ${langRule}
Always respond in 1-2 warm, natural sentences. Help callers book appointments and answer questions empathetically.`;

  const messages = [{ role: 'system', content: systemPrompt }];
  for (const t of history.slice(-6)) {
    messages.push({ role: t.role === 'ai' ? 'assistant' : 'user', content: t.text });
  }
  messages.push({ role: 'user', content: message });

  try {
    const postData = JSON.stringify({
      model: 'openai/gpt-4o-mini',
      messages,
      temperature: 0.7,
      max_tokens: 150
    });

    const reply = await new Promise((resolve) => {
      const opts = {
        hostname: 'openrouter.ai',
        path: '/api/v1/chat/completions',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_KEY}`,
          'HTTP-Referer': 'https://vocalis.ai',
          'X-Title': 'Vocalis AI',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };
      let d = '';
      const orReq = https.request(opts, orRes => {
        orRes.on('data', c => d += c);
        orRes.on('end', () => {
          try {
            const p = JSON.parse(d);
            resolve(p.choices?.[0]?.message?.content?.replace(/[_*#`~]/g, '').trim() || null);
          } catch(e) { resolve(null); }
        });
      });
      orReq.on('error', () => resolve(null));
      orReq.setTimeout(8000, () => { orReq.destroy(); resolve(null); });
      orReq.write(postData);
      orReq.end();
    });

    const finalReply = reply || `Hello! I would be delighted to assist you with booking an appointment at ${bizName}. Shall I check our available times for you?`;

    // Detect if booking is confirmed
    const lowerReply = finalReply.toLowerCase();
    const isBooked = lowerReply.includes('confirm') || lowerReply.includes('booked') || lowerReply.includes('ಖಚಿತ') || lowerReply.includes('ಖಾತರಿ') || lowerReply.includes('कन्फर्म') || lowerReply.includes('ఖరారైంది');

    let callerName = null;
    const nameMatch = message.match(/(?:my name is|name is|i am|ನನ್ನ ಹೆಸರು|मेरा नाम)\s+([a-zA-Z\u0C80-\u0CFF\u0900-\u097F]+)/i);
    if (nameMatch) callerName = nameMatch[1];

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      reply: finalReply,
      source: 'openrouter_gpt4o_mini',
      model: 'openai/gpt-4o-mini',
      language,
      tenant: bizName,
      callerName: callerName || 'Pradeep',
      requestedSlot: 'Tomorrow at 12:30 PM',
      booking: isBooked ? {
        patientName: callerName || 'Pradeep',
        slotTime: 'Tomorrow at 12:30 PM',
        treatment: 'Dental Consultation & Triage',
        clinicName: bizName
      } : null
    }));
  } catch(err) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      reply: `Thank you for calling ${bizName}. How can I assist you with your appointment today?`,
      source: 'resilient_fallback'
    }));
  }
};

