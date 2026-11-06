#!/usr/bin/env bash
# 用法：在服务器上以 root 执行  bash deploy.sh <域名>
# 前提：Ubuntu/Debian；脚本会装 Node 22（node:sqlite 需要）、建 systemd 服务、配 nginx 反代与证书
set -euo pipefail
DOMAIN="${1:-}"
APP_DIR=/opt/angkor-travel
SERVICE_USER=angkor
PORT=8123

if ! command -v node >/dev/null 2>&1 || [ "$(node -v | tr -d 'v' | cut -d. -f1)" -lt 22 ]; then
  echo "==> 安装 Node 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
mkdir -p "$APP_DIR"
cp -f server.js "$APP_DIR"/server.js
chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR"

if [ ! -f /etc/angkor-travel.env ]; then
  cat > /etc/angkor-travel.env <<ENV
PORT=$PORT
ADMIN_DEMO_PASSWORD=$(openssl rand -hex 8)
ADMIN_OPS_PASSWORD=$(openssl rand -hex 8)
ADMIN_SUPPORT_PASSWORD=$(openssl rand -hex 8)
ADMIN_FINANCE_PASSWORD=$(openssl rand -hex 8)
ENV
  chmod 600 /etc/angkor-travel.env
fi

cp -f angkor-travel.service /etc/systemd/system/angkor-travel.service
systemctl daemon-reload
systemctl enable --now angkor-travel
sleep 2
systemctl --no-pager status angkor-travel | head -5
curl -s "http://127.0.0.1:$PORT/api/health"; echo

if [ -n "$DOMAIN" ]; then
  apt-get install -y nginx certbot python3-certbot-nginx >/dev/null
  sed "s/cs.example.com/$DOMAIN/" nginx-angkor.conf > "/etc/nginx/sites-available/$DOMAIN"
  ln -sf "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "admin@$DOMAIN" --redirect || echo "证书申请失败，请检查域名解析是否已指向本机"
fi
echo "==> 完成。管理员密码："; grep ADMIN /etc/angkor-travel.env
