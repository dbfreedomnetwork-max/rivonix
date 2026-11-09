#!/usr/bin/env bash
# Run from apps/mobile. Usage: bash ../../scripts/bootstrap_mobile.sh android
# On macOS, pass android,ios after installing Flutter/Xcode.
set -euo pipefail

platforms="${1:-android}"
case "$platforms" in
  android|ios|android,ios|ios,android) ;;
  *) echo "Supported platforms: android, ios, android,ios" >&2; exit 2 ;;
esac

flutter create --project-name rivonix --platforms="$platforms" .
bash ../../scripts/configure_mobile_permissions.sh

# Flutter's generated template test references MyApp, but Rivonix uses Rivonix().
# Keep the repository-owned smoke test instead.
rm -f test/widget_test.dart
flutter pub get

echo "Rivonix Flutter project bootstrapped for: $platforms"
