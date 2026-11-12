#!/usr/bin/env bash
# End-to-end run on a booted Android emulator. Usage: bash e2e/run.sh path/to/app.apk
set -euo pipefail

APK="$1"
PKG=com.tekkarashi.shibal
OUT=e2e-results
export PATH="$PATH:$HOME/.maestro/bin"
mkdir -p "$OUT"

step() { echo; echo "=== $* ==="; }

step "Install"
adb install -r "$APK"
# Grant up front so the system permission sheet does not cover the first screen.
adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS
adb shell appops set "$PKG" SCHEDULE_EXACT_ALARM allow || true

step "Journey: save, applied + undo, discard guard, delete + undo, settings"
maestro test --format junit --output "$OUT/journey.xml" --test-output-dir "$OUT/journey" e2e/flows/journey.yaml

step "Reminders are registered with Android's alarm service"
alarms=$(adb shell dumpsys alarm | grep -c "$PKG" || true)
echo "Alarm entries for Shibal: $alarms"
if [ "$alarms" -lt 1 ]; then echo "FAIL: no alarms scheduled"; exit 1; fi

step "The test reminder is delivered (scheduled 1 minute ahead)"
delivered=0
for _ in $(seq 1 24); do
  if adb shell dumpsys notification --noredact | grep -q "Test reminder"; then delivered=1; break; fi
  sleep 5
done
adb exec-out screencap -p > "$OUT/09-notification-state.png" || true
if [ "$delivered" -ne 1 ]; then echo "FAIL: test notification did not arrive within 2 minutes"; exit 1; fi
echo "Test notification delivered"

step "Share a message into the app"
when=$(date -d "+10 days" "+%-d %B")
adb shell "am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT 'Chevening Scholarships 2027. Deadline: $when https://chevening.org/apply' $PKG"
maestro test --format junit --output "$OUT/share.xml" --test-output-dir "$OUT/share" e2e/flows/share.yaml

step "All end-to-end checks passed"
