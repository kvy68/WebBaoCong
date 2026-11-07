#!/data/data/com.termux/files/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
ROOT_DIR="$(pwd)"
ANDROID_JAR="/data/data/com.termux/files/usr/share/java/android.jar"
FRAMEWORK_RES="/system/framework/framework-res.apk"
BUILD_DIR="$ROOT_DIR/build"
GEN_DIR="$BUILD_DIR/gen"
OBJ_DIR="$BUILD_DIR/obj"
DEX_DIR="$BUILD_DIR/dex"
DIST_DIR="$ROOT_DIR/dist"
KEYSTORE_DIR="$ROOT_DIR/keystore"
KEYSTORE_FILE="$KEYSTORE_DIR/tbt-webadmin.jks"
FINAL_APK="$DIST_DIR/TBT-QuanTriWeb-v2.0.0.apk"

echo "🎨 [1/6] Tạo bộ biểu tượng (Launcher Icons) cho Android..."
node "$ROOT_DIR/gen-icons.js"

rm -rf "$BUILD_DIR"
mkdir -p "$GEN_DIR" "$OBJ_DIR" "$DEX_DIR" "$DIST_DIR" "$KEYSTORE_DIR"

echo "📦 [2/6] Biên dịch tài nguyên Android (aapt)..."
aapt package -f -m \
  -J "$GEN_DIR" \
  -M "$ROOT_DIR/AndroidManifest.xml" \
  -S "$ROOT_DIR/res" \
  -I "$FRAMEWORK_RES"

echo "☕ [3/6] Biên dịch mã nguồn Java (javac)..."
javac -source 1.8 -target 1.8 -encoding UTF-8 \
  -bootclasspath "$ANDROID_JAR" \
  -classpath "$ANDROID_JAR" \
  -d "$OBJ_DIR" \
  $(find "$ROOT_DIR/src" "$GEN_DIR" -name "*.java")

echo "⚙️ [4/6] Chuyển đổi bytecode sang Dalvik DEX (d8)..."
CLASS_FILES=$(find "$OBJ_DIR" -name "*.class")
d8 --lib "$ANDROID_JAR" --min-api 21 --output "$DEX_DIR" $CLASS_FILES

echo "🗜️ [5/6] Đóng gói & Căn chỉnh APK (aapt + zipalign)..."
UNALIGNED_APK="$BUILD_DIR/unaligned.apk"
ALIGNED_APK="$BUILD_DIR/aligned.apk"

aapt package -f \
  -M "$ROOT_DIR/AndroidManifest.xml" \
  -S "$ROOT_DIR/res" \
  -I "$FRAMEWORK_RES" \
  -F "$UNALIGNED_APK"

# Đưa classes.dex vào gốc của gói APK
(
  cd "$DEX_DIR"
  aapt add "$UNALIGNED_APK" classes.dex >/dev/null
)

zipalign -f 4 "$UNALIGNED_APK" "$ALIGNED_APK"

echo "🔐 [6/6] Ký số chứng chỉ phát hành APK (apksigner v1+v2)..."
if [ ! -f "$KEYSTORE_FILE" ]; then
  keytool -genkeypair \
    -keystore "$KEYSTORE_FILE" \
    -alias tbtwebadmin \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -storepass tbt2026admin \
    -keypass tbt2026admin \
    -dname "CN=TBT Webmaster, OU=Trinh Ba Tu, O=TBT Bao Cong, L=HCM, ST=HCM, C=VN"
fi

apksigner sign \
  --ks "$KEYSTORE_FILE" \
  --ks-key-alias tbtwebadmin \
  --ks-pass pass:tbt2026admin \
  --key-pass pass:tbt2026admin \
  --v1-signing-enabled true \
  --v2-signing-enabled true \
  --out "$FINAL_APK" \
  "$ALIGNED_APK"

apksigner verify --verbose "$FINAL_APK" | head -n 6
ls -lh "$FINAL_APK"
echo "✅ Hoàn tất! File APK tại: $FINAL_APK"
