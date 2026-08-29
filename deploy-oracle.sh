#!/bin/bash
# ==========================================================
# Vocalis AI — Automated Oracle Cloud Deployment Script
# ==========================================================

set -e

echo "🚀 [Vocalis AI] Starting Oracle Cloud Server Setup..."

# 1. Update system packages
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y curl git ufw

# 2. Install Docker if not installed
if ! command -v docker &> /dev/null; then
    echo "📦 Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER
fi

# 3. Install Docker Compose plugin
sudo apt-get install -y docker-compose-plugin

# 4. Enable Docker systemd auto-restart on boot
sudo systemctl enable docker
sudo systemctl start docker

# 5. Open Firewall ports for Web & Telephony
echo "🛡️ Configuring Firewall Ports..."
sudo ufw allow 22/tcp || true
sudo ufw allow 80/tcp || true
sudo ufw allow 443/tcp || true
sudo ufw allow 3300/tcp || true
sudo ufw --force enable || true

# 6. Build and start Vocalis containers
echo "⚡ Starting Vocalis AI Microservices & Background Workers..."
docker compose down || true
docker compose up -d --build

echo ""
echo "=========================================================="
echo "🎉 VOCALIS AI IS NOW LIVE ON YOUR ORACLE CLOUD SERVER!"
echo "• Web Panel: http://$(curl -s ifconfig.me):3300/index.html"
echo "• Live Demo: http://$(curl -s ifconfig.me):3300/demo.html"
echo "• Telephony Webhook: POST http://$(curl -s ifconfig.me):3300/v1/telephony/inbound"
echo "• Live Logs: docker compose logs -f"
echo "=========================================================="
