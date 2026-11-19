#!/usr/bin/env bash
set -euo pipefail

npm run build
npx cap sync ios

rm -rf build/Payload build/SweetTune.xcarchive build/SweetTune.ipa
mkdir -p build/Payload

xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath build/SweetTune.xcarchive \
  CODE_SIGN_IDENTITY="" \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGNING_ALLOWED=NO \
  archive

cp -R build/SweetTune.xcarchive/Products/Applications/App.app build/Payload/
(cd build && zip -rq SweetTune.ipa Payload)
rm -rf build/Payload build/SweetTune.xcarchive

echo "Created build/SweetTune.ipa"
