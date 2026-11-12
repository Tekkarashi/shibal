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
# CI emulators sometimes show "Pixel Launcher isn't responding" over the app. Hide system
# ANR/crash dialogs (crashes are still captured from the log) and let the launcher settle.
adb shell settings put global hide_error_dialogs 1 || true
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS > /dev/null || true
sleep 30
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

step "Shibal is offered in Android's share sheet for every type WhatsApp, TikTok and Instagram send"
for type in text/plain image/jpeg image/png application/zip; do
  if adb shell cmd package query-activities --brief -a android.intent.action.SEND -t "$type" | grep -q "$PKG/"; then
    echo "  offered for $type"
  else
    echo "FAIL: Shibal is not offered when sharing $type"; exit 1
  fi
done
if adb shell dumpsys package "$PKG" | grep -q 'label="Save to Shibal"'; then echo '  labelled "Save to Shibal"'; fi

# Puts a file in shared storage and prints its content:// uri, the way another app would hand it over.
media_uri() {
  local src="$1" dest="$2" table="$3" name
  name=$(basename "$dest")
  adb push "$src" "$dest" > /dev/null
  adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file://$dest" > /dev/null
  for _ in $(seq 1 15); do
    id=$(adb shell "content query --uri content://media/external/$table --projection _id --where \"_display_name='$name'\"" | sed -n 's/.*_id=\([0-9]*\).*/\1/p' | head -1)
    if [ -n "$id" ]; then echo "content://media/external/$table/$id"; return 0; fi
    sleep 2
  done
  return 1
}

# Prints the app's own log lines and any crash since the last clear, so a failure shows its cause.
app_log() {
  local name="$1"
  adb logcat -d -v time > "$OUT/logcat-$name.txt" || true
  echo "  --- crash buffer ---"
  adb logcat -d -b crash | tail -40 || true
  echo "  --- app log ---"
  grep -E "ReactNativeJS|ExpoShareIntent|expo-share-intent|AndroidRuntime|$PKG" "$OUT/logcat-$name.txt" | tail -40 || true
}

step "Share a flyer image, as WhatsApp does with a forwarded poster"
img=$(media_uri e2e/fixtures/flyer.jpg /sdcard/Pictures/shibal-e2e-flyer.jpg images/media) || { echo "FAIL: flyer not indexed"; exit 1; }
echo "  $img"
adb logcat -c || true
adb shell "am start -a android.intent.action.SEND -t image/jpeg --eu android.intent.extra.STREAM $img --grant-read-uri-permission $PKG"
sleep 4
app_log image
maestro test --format junit --output "$OUT/share-image.xml" --test-output-dir "$OUT/share-image" e2e/flows/share-image.yaml

step "Share a WhatsApp 'Export chat' zip"
zip=$(media_uri e2e/fixtures/whatsapp-chat.zip /sdcard/Download/shibal-e2e-chat.zip file) || { echo "FAIL: zip not indexed"; exit 1; }
echo "  $zip"
adb logcat -c || true
adb shell "am start -a android.intent.action.SEND -t application/zip --eu android.intent.extra.STREAM $zip --grant-read-uri-permission $PKG"
sleep 4
app_log zip
maestro test --format junit --output "$OUT/share-zip.xml" --test-output-dir "$OUT/share-zip" e2e/flows/share-zip.yaml

step "All end-to-end checks passed"
