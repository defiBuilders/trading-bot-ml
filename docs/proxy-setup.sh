#!/bin/bash
# ─────────────────────────────────────────────────────────────
# HTTPS Proxy Setup (Squid) — run this on your remote server
# Usage: scp this file to server, then: chmod +x proxy-setup.sh && sudo ./proxy-setup.sh
# ─────────────────────────────────────────────────────────────

set -e

PROXY_PORT=3128
PROXY_USER="proxyuser"

echo "==> Installing Squid..."
apt update && apt install squid apache2-utils -y

echo "==> Creating proxy user '$PROXY_USER'..."
echo "    (You'll be prompted to set a password)"
htpasswd -c /etc/squid/passwd "$PROXY_USER"

echo "==> Backing up default config..."
cp /etc/squid/squid.conf /etc/squid/squid.conf.bak

echo "==> Writing Squid config..."
cat > /etc/squid/squid.conf << CONF
# Listen on port $PROXY_PORT
http_port $PROXY_PORT

# Basic auth
auth_param basic program /usr/lib/squid/basic_ncsa_auth /etc/squid/passwd
auth_param basic realm Proxy
acl authenticated proxy_auth REQUIRED
http_access allow authenticated
http_access deny all

# Hide proxy headers
forwarded_for off
request_header_access Via deny all
request_header_access X-Forwarded-For deny all

# DNS
dns_nameservers 8.8.8.8 1.1.1.1
CONF

echo "==> Restarting Squid..."
systemctl restart squid
systemctl enable squid

echo "==> Opening firewall port $PROXY_PORT..."
ufw allow "$PROXY_PORT/tcp" 2>/dev/null || true

echo ""
echo "==> Done! Test with:"
echo "    curl -x http://$PROXY_USER:YOUR_PASSWORD@localhost:$PROXY_PORT https://api.ipify.org"
echo ""
echo "==> Then add to your .env:"
echo "    PROXY_URL=http://$PROXY_USER:YOUR_PASSWORD@YOUR_SERVER_IP:$PROXY_PORT"
