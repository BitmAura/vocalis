function configured() {
  const twilio = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
  return {
    twilioVoice: twilio,
    twilioSms: twilio,
    twilioWhatsapp: !!process.env.TWILIO_WHATSAPP_FROM,
    gupshup: !!(process.env.GUPSHUP_API_KEY && process.env.GUPSHUP_APP_NAME),
    cal: !!(process.env.CAL_API_KEY && process.env.CAL_EVENT_TYPE_ID),
    gemini: !!process.env.GEMINI_API_KEY,
    openRouter: !!process.env.OPENROUTER_API_KEY,
    nvidia: !!process.env.NVIDIA_API_KEY,
    deepgram: !!process.env.DEEPGRAM_API_KEY,
    elevenLabs: !!process.env.ELEVENLABS_API_KEY,
    stripe: !!process.env.STRIPE_SECRET_KEY,
    vercel: !!process.env.VERCEL,
    adminKeySet: !!process.env.ADMIN_API_KEY
  };
}

module.exports = { configured };
