#!/usr/bin/env bash
# Run from apps/mobile after "flutter create --platforms=android,ios .".
# Idempotently injects the permissions required by current Rivonix mobile features.
set -euo pipefail

python3 - <<'PY'
from pathlib import Path
import xml.etree.ElementTree as ET

manifest = Path("android/app/src/main/AndroidManifest.xml")
plist = Path("ios/Runner/Info.plist")
if not manifest.exists() or not plist.exists():
    raise SystemExit("Missing Flutter native shells. Run: flutter create --platforms=android,ios .")

ET.register_namespace("android", "http://schemas.android.com/apk/res/android")
tree = ET.parse(manifest)
root = tree.getroot()
names = [
    "android.permission.INTERNET",
    "android.permission.CAMERA",
    "android.permission.RECORD_AUDIO",
    "android.permission.MODIFY_AUDIO_SETTINGS",
    "android.permission.ACCESS_NETWORK_STATE",
]
existing = {e.get("{http://schemas.android.com/apk/res/android}name") for e in root.findall("uses-permission")}
for name in names:
    if name not in existing:
        element = ET.Element("uses-permission")
        element.set("{http://schemas.android.com/apk/res/android}name", name)
        root.insert(0, element)
tree.write(manifest, encoding="utf-8", xml_declaration=True)

import plistlib
with plist.open("rb") as source:
    values = plistlib.load(source)
values.setdefault("NSCameraUsageDescription",
    "Rivonix needs camera access when you choose to broadcast LIVE.")
values.setdefault("NSMicrophoneUsageDescription",
    "Rivonix needs microphone access when you choose to broadcast LIVE.")
values.setdefault("NSPhotoLibraryUsageDescription",
    "Rivonix lets you select photos and videos to share.")
with plist.open("wb") as target:
    plistlib.dump(values, target)

print("Android and iOS permissions configured.")
PY
