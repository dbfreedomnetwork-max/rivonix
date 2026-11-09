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
# Use the Rivonix product name in the Android launcher.
application = root.find("application")
if application is None:
    raise SystemExit("AndroidManifest.xml has no application element")
application.set("{http://schemas.android.com/apk/res/android}label", "Rivonix")
tree.write(manifest, encoding="utf-8", xml_declaration=True)

# Allow the documented localhost development API ONLY in debug builds.
debug_manifest = Path("android/app/src/debug/AndroidManifest.xml")
if debug_manifest.exists():
    debug_tree = ET.parse(debug_manifest)
    debug_root = debug_tree.getroot()
    debug_app = debug_root.find("application")
    if debug_app is None:
        debug_app = ET.SubElement(debug_root, "application")
    debug_app.set("{http://schemas.android.com/apk/res/android}usesCleartextTraffic", "true")
    debug_tree.write(debug_manifest, encoding="utf-8", xml_declaration=True)

# Flutter plugins (including secure storage) may require Android API 23+.
# Configure min SDK 24 for this new app, without touching target/compile SDKs.
for gradle in [Path("android/app/build.gradle.kts"), Path("android/app/build.gradle")]:
    if not gradle.exists():
        continue
    source = gradle.read_text()
    source = source.replace("minSdk = flutter.minSdkVersion", "minSdk = 24")
    source = source.replace("minSdkVersion flutter.minSdkVersion", "minSdkVersion 24")
    gradle.write_text(source)

import plistlib
with plist.open("rb") as source:
    values = plistlib.load(source)
values["CFBundleDisplayName"] = "Rivonix"
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
