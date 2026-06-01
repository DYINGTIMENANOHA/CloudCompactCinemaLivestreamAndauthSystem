#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
SYSTEM_CONFIG="${SYSTEM_CONFIG:-$APP_DIR/system.config}"
if [ -f "$SYSTEM_CONFIG" ]; then
  set -a
  . "$SYSTEM_CONFIG"
  set +a
fi

SRS_CONTAINER="${SRS_CONTAINER:-srs}"
SRS_IMAGE="${SRS_IMAGE:-ossrs/srs:5}"
SRS_RTMP_PORT="${SRS_RTMP_PORT:-1935}"
SRS_HTTP_PORT="${SRS_HTTP_PORT:-8090}"
SRS_API_PORT="${SRS_API_PORT:-1985}"
LIVESTREAM_PORT="${LIVESTREAM_PORT:-8888}"

python3 - "$APP_DIR/srs/srs.conf" "$APP_DIR/srs/srs.runtime.conf" "$SRS_RTMP_PORT" "$SRS_HTTP_PORT" "$SRS_API_PORT" "$LIVESTREAM_PORT" <<'PY'
from pathlib import Path
import re
import sys

template, output, rtmp_port, http_port, api_port, app_port = sys.argv[1:7]
text = Path(template).read_text(encoding="utf-8")
text = re.sub(r"(?m)^listen\s+\d+\s*;", f"listen              {rtmp_port};", text, count=1)
text = re.sub(
    r"(http_server\s*\{.*?listen\s+)\d+(\s*;)",
    rf"\g<1>{http_port}\2",
    text,
    count=1,
    flags=re.S,
)
text = re.sub(
    r"(http_api\s*\{.*?listen\s+)\d+(\s*;)",
    rf"\g<1>{api_port}\2",
    text,
    count=1,
    flags=re.S,
)
text = re.sub(
    r"on_publish\s+http://127\.0\.0\.1:\d+/api/auth/publish;",
    f"on_publish  http://127.0.0.1:{app_port}/api/auth/publish;",
    text,
    count=1,
)
Path(output).write_text(text, encoding="utf-8")
PY

docker rm -f "$SRS_CONTAINER" >/dev/null 2>&1 || true
exec docker run --name "$SRS_CONTAINER" --network host \
  -v "$APP_DIR/srs/srs.runtime.conf:/usr/local/srs/conf/srs.conf:ro" \
  "$SRS_IMAGE" ./objs/srs -c conf/srs.conf
