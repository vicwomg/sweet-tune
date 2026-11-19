#!/usr/bin/env bash
set -euo pipefail

if [ -z "${JAVA_HOME:-}" ] && [ -d "/Applications/Android Studio.app/Contents/jbr/Contents/Home" ]; then
  export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  export PATH="$JAVA_HOME/bin:$PATH"
fi

if [ -z "${ANDROID_HOME:-}" ] && [ -d "$HOME/Library/Android/sdk" ]; then
  export ANDROID_HOME="$HOME/Library/Android/sdk"
  export ANDROID_SDK_ROOT="$ANDROID_HOME"
fi

npm run build
npx cap sync android

(cd android && ./gradlew assembleDebug)

mkdir -p build
cp android/app/build/outputs/apk/debug/app-debug.apk build/SweetTune.apk

echo "Created build/SweetTune.apk"
