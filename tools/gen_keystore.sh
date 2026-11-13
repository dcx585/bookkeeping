#!/bin/sh
# 生成 Android 签名用 keystore（不依赖 keytool，沙箱里 JVM 起不来）
#
# 用法：
#   sh tools/gen_keystore.sh <输出路径> [别名]
#
# 注意：生成后要妥善保存！丢了就无法覆盖升级。
set -eu

OUT="${1:-release.keystore}"
ALIAS="${2:-bookkeeping}"
PASS_FILE="${OUT%.keystore}_password.txt"

if [ -f "$OUT" ]; then
  echo "❌ $OUT 已存在，先备份再删"
  exit 1
fi

# 生成一个 32 位随机口令
PASS=$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 24)
echo "$PASS" > "$PASS_FILE"
chmod 600 "$PASS_FILE"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# 1. 生成 2048 位 RSA 私钥
openssl genrsa -out "$TMP/key.pem" 2048 2>/dev/null

# 2. 自签证书，有效期 10000 天（约 27 年）
openssl req -new -x509 -key "$TMP/key.pem" -out "$TMP/cert.pem" -days 10000 \
  -subj "/CN=$ALIAS/O=Android/OU=Mobile/C=CN" \
  -sha256 2>/dev/null

# 3. 打包成 PKCS#12
#    -legacy：用 3DES 加密，兼容老版本 keytool / Android Gradle Plugin
#    新版 openssl 默认 AES-256，部分 AGP 版本读不了
openssl pkcs12 -export \
  -in "$TMP/cert.pem" \
  -inkey "$TMP/key.pem" \
  -name "$ALIAS" \
  -out "$OUT" \
  -passout "pass:$PASS" \
  -legacy 2>/dev/null

if [ ! -f "$OUT" ]; then
  echo "❌ 生成失败"
  exit 1
fi

echo "✅ 已生成 $OUT"
echo "   别名: $ALIAS"
echo "   口令: 见 $PASS_FILE"
echo ""
echo "验证："
openssl pkcs12 -in "$OUT" -passin "pass:$PASS" -nokeys -noout 2>&1 && echo "   PKCS#12 结构有效"
