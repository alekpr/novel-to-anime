#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

# 1) ตรวจว่า MongoDB ทำงานอยู่
if ! brew services list 2>/dev/null | grep -E "mongodb-community.*started" >/dev/null 2>&1; then
  if command -v mongod >/dev/null 2>&1; then
    echo "MongoDB ไม่ได้รันผ่าน brew services — ตรวจสอบว่า mongod ทำงานอยู่แล้ว"
  else
    echo "ไม่พบ MongoDB — กรุณาติดตั้งและเริ่ม MongoDB ก่อน"
    exit 1
  fi
fi

# 2) ติดตั้ง dependencies ถ้ายังไม่ได้ทำ
[ -d node_modules ] || npm ci

# 3) build ถ้ายังไม่ได้ทำ
[ -d dist ] || npm run build

# 4) เปิดเบราว์เซอร์แล้วรันเซิร์ฟเวอร์
( sleep 2; open "http://localhost:3000" ) &
exec caffeinate -i node dist/server.js
