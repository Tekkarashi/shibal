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

# Hands a file to Shibal the way a sending app with access would. The emulator's shell may not
# grant access to gallery (MediaStore) items, so the file goes in Shibal's own shared-storage
# folder, which the app can always read, and is shared by its file:// address.
APP_FILES=/sdcard/Android/data/$PKG/files
share_file() {
  local src="$1" mime="$2" name dest
  name=$(basename "$src")
  dest="$APP_FILES/e2e-$name"
  adb shell mkdir -p "$APP_FILES"
  adb push "$src" "$dest" > /dev/null
  echo "  sharing file://$dest as $mime"
  adb logcat -c || true
  adb shell "am start -a android.intent.action.SEND -t $mime --eu android.intent.extra.STREAM file://$dest $PKG"
  sleep 1.5
  adb exec-out screencap -p > "$OUT/just-after-sharing-$name.png" || true
  sleep 3
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
share_file e2e/fixtures/flyer.jpg image/jpeg
app_log image
maestro test --format junit --output "$OUT/share-image.xml" --test-output-dir "$OUT/share-image" e2e/flows/share-image.yaml

step "Share a WhatsApp 'Export chat' zip"
share_file e2e/fixtures/whatsapp-chat.zip application/zip
app_log zip
maestro test --format junit --output "$OUT/share-zip.xml" --test-output-dir "$OUT/share-zip" e2e/flows/share-zip.yaml

step "All end-to-end checks passed"
