#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
SYSTEM_CONFIG="${SYSTEM_CONFIG:-$REPO_DIR/system.config}"

load_system_config() {
  local config_file="$1"
  local raw_line line key value
  [ -f "$config_file" ] || return 0
  while IFS= read -r raw_line || [ -n "$raw_line" ]; do
    line="${raw_line#"${raw_line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [ -z "$line" ] && continue
    case "$line" in \#*) continue ;; esac
    case "$line" in
      *=*)
        key="${line%%=*}"
        value="${line#*=}"
        key="${key#"${key%%[![:space:]]*}"}"
        key="${key%"${key##*[![:space:]]}"}"
        value="${value#"${value%%[![:space:]]*}"}"
        value="${value%"${value##*[![:space:]]}"}"
        value="${value%\"}"; value="${value#\"}"
        value="${value%\'}"; value="${value#\'}"
        if [ -z "${!key+x}" ]; then
          export "$key=$value"
        fi
        ;;
    esac
  done < "$config_file"
}

prompt() {
  local var_name="$1"
  local label="$2"
  local default_value="${3:-}"
  local value
  if [ -n "${!var_name:-}" ]; then
    return 0
  fi
  if [ -n "$default_value" ]; then
    read -r -p "$label [$default_value]: " value
    value="${value:-$default_value}"
  else
    read -r -p "$label: " value
  fi
  export "$var_name=$value"
}

prompt_yes_no() {
  local var_name="$1"
  local label="$2"
  local default_value="$3"
  local value suffix
  if [ -n "${!var_name:-}" ]; then
    return 0
  fi
  case "$default_value" in
    y|Y|yes|YES) suffix="Y/n" ;;
    *) suffix="y/N" ;;
  esac
  read -r -p "$label [$suffix]: " value
  value="${value:-$default_value}"
  case "$value" in
    y|Y|yes|YES|true|TRUE|1) export "$var_name=yes" ;;
    *) export "$var_name=no" ;;
  esac
}

replace_config_value() {
  local key="$1"
  local value="$2"
  local file="$3"
  [ -f "$file" ] || return 0
  if grep -qE "^${key}=" "$file"; then
    sudo sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  fi
}

load_system_config "$SYSTEM_CONFIG"

DOMAIN_DEFAULT="${PUBLIC_DOMAIN:-}"
[ "$DOMAIN_DEFAULT" = "YOUR_DOMAIN" ] && DOMAIN_DEFAULT=""

prompt DOMAIN "Public domain, for example live.example.com" "$DOMAIN_DEFAULT"
if [ -z "${DOMAIN:-}" ]; then
  echo "Domain is required."
  exit 1
fi

prompt_yes_no ENABLE_HTTPS "Request and configure Let's Encrypt HTTPS certificate" "yes"
if [ "$ENABLE_HTTPS" = "yes" ]; then
  prompt CERTBOT_EMAIL "Certbot email, leave empty to register without email" "${CERTBOT_EMAIL:-}"
fi
prompt_yes_no EXPOSE_SRS_API "Expose SRS API /api/v1/ through nginx" "no"
prompt_yes_no UPDATE_SYSTEM_CONFIG "Update PUBLIC_DOMAIN in system.config" "yes"

CONF_NAME="${CONF_NAME:-cloud-system}"
NGINX_HTTP_PORT="${NGINX_HTTP_PORT:-80}"
CINEMA_HOST="${CINEMA_HOST:-127.0.0.1}"
CINEMA_PORT="${CINEMA_PORT:-8890}"
CINEMA_BASE_DIR="${CINEMA_BASE_DIR:-/opt/cinema}"
CINEMA_STATIC_DIR="${CINEMA_STATIC_DIR:-$CINEMA_BASE_DIR/static}"
CINEMA_VIDEOS_DIR="${CINEMA_VIDEOS_DIR:-$CINEMA_BASE_DIR/videos}"
LIVESTREAM_HOST="${LIVESTREAM_HOST:-127.0.0.1}"
LIVESTREAM_PORT="${LIVESTREAM_PORT:-8888}"
SRS_HOST="${SRS_HOST:-127.0.0.1}"
SRS_HTTP_PORT="${SRS_HTTP_PORT:-8090}"
SRS_API_PORT="${SRS_API_PORT:-1985}"

CONF_AVAILABLE="/etc/nginx/sites-available/$CONF_NAME.conf"
CONF_ENABLED="/etc/nginx/sites-enabled/$CONF_NAME.conf"

echo "Installing nginx..."
sudo apt-get update
sudo apt-get install -y nginx

if [ "$ENABLE_HTTPS" = "yes" ]; then
  sudo apt-get install -y certbot python3-certbot-nginx
fi

if [ -e "$CONF_AVAILABLE" ]; then
  backup="$CONF_AVAILABLE.$(date +%Y%m%d_%H%M%S).bak"
  echo "Backing up existing config to $backup"
  sudo cp "$CONF_AVAILABLE" "$backup"
fi

tmp_conf="$(mktemp)"
cat > "$tmp_conf" <<EOF
server {
    listen ${NGINX_HTTP_PORT};
    server_name ${DOMAIN};

    client_max_body_size 4096m;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location /cinema/static/ {
        alias ${CINEMA_STATIC_DIR}/;
        expires 7d;
        add_header Cache-Control "public";
    }

    location /cinema/videos/ {
        alias ${CINEMA_VIDEOS_DIR}/;
        mp4;
        add_header Accept-Ranges bytes;
    }

    location /cinema/ws {
        proxy_pass http://${CINEMA_HOST}:${CINEMA_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 3600s;
    }

    location /cinema/chat-ws {
        proxy_pass http://${CINEMA_HOST}:${CINEMA_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 3600s;
    }

    location /cinema/ {
        proxy_pass http://${CINEMA_HOST}:${CINEMA_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /live/ {
        proxy_pass http://${SRS_HOST}:${SRS_HTTP_PORT}/live/;
        proxy_http_version 1.1;
        proxy_set_header Host \$http_host;
        proxy_buffering on;
        proxy_cache off;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Access-Control-Allow-Origin * always;
    }

    location /test/ {
        proxy_pass http://${SRS_HOST}:${SRS_HTTP_PORT}/test/;
        proxy_http_version 1.1;
        proxy_set_header Host \$http_host;
        proxy_buffering on;
        proxy_cache off;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Access-Control-Allow-Origin * always;
    }
EOF

if [ "$EXPOSE_SRS_API" = "yes" ]; then
  cat >> "$tmp_conf" <<EOF

    location /api/v1/ {
        proxy_pass http://${SRS_HOST}:${SRS_API_PORT}/api/v1/;
        proxy_set_header Host \$host;
        add_header Access-Control-Allow-Origin * always;
    }
EOF
fi

cat >> "$tmp_conf" <<EOF

    location / {
        proxy_pass http://${LIVESTREAM_HOST}:${LIVESTREAM_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

sudo mv "$tmp_conf" "$CONF_AVAILABLE"
sudo ln -sfn "$CONF_AVAILABLE" "$CONF_ENABLED"
sudo mkdir -p /var/www/html

sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx

if [ "$ENABLE_HTTPS" = "yes" ]; then
  if [ "$NGINX_HTTP_PORT" != "80" ]; then
    echo "Skipping certbot: Let's Encrypt HTTP validation expects nginx on port 80."
    echo "Set NGINX_HTTP_PORT=80 and rerun this script, or configure your certificate manually."
  elif [ -n "${CERTBOT_EMAIL:-}" ]; then
    sudo certbot --nginx -d "$DOMAIN" --redirect --agree-tos --non-interactive -m "$CERTBOT_EMAIL"
  else
    sudo certbot --nginx -d "$DOMAIN" --redirect --agree-tos --non-interactive --register-unsafely-without-email
  fi
fi

if [ "$UPDATE_SYSTEM_CONFIG" = "yes" ]; then
  replace_config_value "PUBLIC_DOMAIN" "$DOMAIN" "$SYSTEM_CONFIG"
fi

echo
echo "Nginx config installed: $CONF_AVAILABLE"
echo "Public web URL: http://$DOMAIN/"
if [ "$ENABLE_HTTPS" = "yes" ]; then
  echo "Public HTTPS URL: https://$DOMAIN/"
fi
echo "Cinema URL: /cinema/"
echo "RTMP push example: rtmp://$DOMAIN:${PUBLIC_RTMP_PORT:-${SRS_RTMP_PORT:-1935}}/live/stream?key=ADMIN_TOKEN"
