#!/bin/bash
# Vocalis Oracle — smooth voice setup (pm2 + Cloudflare Tunnel, no Docker)
set -e

APP_DIR="${APP_DIR:-$HOME/vocalis}"
PORT="${PORT:-3300}"

echo "== Vocalis Oracle Voice Setup =="

# 1. Node.js 20+
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# 2. pm2
if ! command -v pm2 &>/dev/null; then
  sudo npm install -g pm2
fi

# 3. cloudflared (HTTPS/WSS tunnel — Twilio requires wss://)
if ! command -v cloudflared &>/dev/null; then
  curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb
  sudo dpkg -i /tmp/cloudflared.deb || sudo apt-get install -f -y
fi

# 4. Python for OSS voice (optional)
if command -v pip3 &>/dev/null && [ -f "$APP_DIR/backend/mit-voice/requirements.txt" ]; then
  pip3 install -r "$APP_DIR/backend/mit-voice/requirements.txt" || echo "WARN: mit-voice deps failed — use GOOGLE_TTS_API_KEY instead"
fi

# 5. Install deps
cd "$APP_DIR/backend"
npm install --production

# 6. Env file
if [ ! -f "$APP_DIR/backend/.env" ]; then
  cp "$APP_DIR/.env.oracle.example" "$APP_DIR/backend/.env"
  echo "Created backend/.env — EDIT IT before starting!"
fi

# 7. Start app with pm2
pm2 delete vocalis-voice 2>/dev/null || true
pm2 start server.js --name vocalis-voice --cwd "$APP_DIR/backend"
pm2 save
sudo env PATH=$PATH pm2 startup systemd -u "$USER" --hp "$HOME" || true

echo ""
echo "=========================================="
echo "Next steps (manual — one time):"
echo ""
echo "1. Edit $APP_DIR/backend/.env"
echo "   USE_MEDIA_STREAM=true"
echo "   OPENROUTER_API_KEY=..."
echo "   TWILIO_*=..."
echo "   DEEPGRAM_API_KEY=... (recommended)"
echo "   GOOGLE_TTS_API_KEY=... (recommended for mulaw voice)"
echo ""
echo "2. Start Cloudflare Tunnel (replace with your domain):"
echo "   cloudflared tunnel --url http://localhost:$PORT"
echo "   OR permanent tunnel:"
echo "   cloudflared tunnel create vocalis"
echo "   cloudflared tunnel route dns vocalis voice.yourdomain.com"
echo "   cloudflared tunnel run vocalis"
echo ""
echo "3. Set in .env:"
echo "   PUBLIC_BASE_URL=https://voice.yourdomain.com"
echo "   VOICE_WS_URL=wss://voice.yourdomain.com/v1/stream"
echo ""
echo "4. Twilio Console → your number → Voice webhook:"
echo "   POST https://voice.yourdomain.com/v1/telephony/inbound"
echo ""
echo "5. Test health:"
echo "   curl https://voice.yourdomain.com/api/health"
echo ""
echo "6. pm2 logs vocalis-voice"
echo "=========================================="
