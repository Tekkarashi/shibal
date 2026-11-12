# Shibal

**Free Android app for deadlines.** A place to keep every application, fellowship, hackathon and opportunity you come across, sorted by how soon it closes, with reminders that reach you before it does.

## Download Shibal

**[⬇ Download Shibal for Android](https://tekkarashi.github.io/shibal/)**: the download page always has the newest version, install steps and every past release.

Direct link to the latest APK: [Shibal.apk](https://github.com/Tekkarashi/shibal/releases/latest/download/Shibal.apk) · All versions: [Releases](https://github.com/Tekkarashi/shibal/releases)

It exists because links saved in a WhatsApp chat with yourself, browser bookmarks and screenshots get buried, and the deadline passes while you are not looking. Shibal replaces the pile with one list that goes looking for you.

Everything is stored on your phone. Nothing is uploaded and there is no account.

## Install

1. On your phone, open the [download page](https://tekkarashi.github.io/shibal/) and tap **Download Shibal**. It needs Android 7 or newer.
2. Open the file. Android will ask you to allow installs from your browser or file manager. Allow it for this install.
3. Open Shibal and allow notifications when asked.
4. Go to Settings and tap **Send a test**. Swipe the app away and lock the phone. If the reminder arrives, you are set.

**Updates:** Shibal checks for new versions itself (at most every 6 hours, only while you use it). When one is out, a banner on the home screen takes you to Settings → App update, which downloads it and opens Android's installer: tap Update and your saved items and reminders stay. The first time, Android asks you to allow Shibal to install apps.

## Using it

**Save.** In WhatsApp, Instagram, TikTok, X, Chrome, Telegram or any app with a Share button, tap Share and choose **Save to Shibal**. Shared flyers and screenshots are kept with the item. The title and link are filled in for you. If the text mentions a date such as "Deadline: 30 November", it is picked up and shown so you can check it. Set a deadline and save.

**Sort.** The home screen leads with what closes next and a countdown, then groups the rest by urgency: missed, due today, next 3 days, this week, later, and links that still need a deadline. Swipe a card right when you have applied, left to skip it. Every change can be undone from the toast that follows.

**Remind.** Each deadline gets a ladder of reminders: 1 week, 3 days and 1 day before at 9 AM, the morning of the deadline at 8 AM, then 3 hours and 1 hour before. A morning summary at 8 AM appears on days when something is due within 3 days, and on Mondays it tells you how many saved links still have no deadline. Reminders already in the past when you save are skipped, and ones that would land within 45 minutes of each other are merged.

**Tap a reminder** and the item opens, with a button to open the link.

## Move your links out of WhatsApp

In your chat with yourself: three dots, More, Export chat, **Without media**, then pick **Save to Shibal**. Newer WhatsApp versions make a .zip and older ones a .txt; Shibal reads both. You can also pick the file under Settings. You choose how far back to import. Links arrive under "Needs a deadline", and a deadline is filled in only when the message says something like "deadline" or "closes" next to a date.

## Reminders on Tecno, Infinix and itel phones

Many phones stop background apps to save battery, and the worst offenders delay or drop alarms. Shibal does three things about it:

- Last-day reminders use the same Android delivery path as an alarm clock, which the system does not defer. You can turn this off in Settings if the alarm icon in the status bar bothers you.
- Settings shows whether notifications and exact alarms are allowed, and links to your phone's battery settings with a tip for your brand.
- The test button lets you check delivery on your own phone instead of finding out on deadline day.

On Tecno, Infinix and itel, also allow auto-start for the app, set its battery use to unrestricted and lock it in the recent-apps list. Menu names differ by model. [dontkillmyapp.com](https://dontkillmyapp.com/) collects what is known per brand.

## Email

Email reminders are not built in. Any saved item can be added to Google Calendar with one tap. Google Calendar can send event notifications by email if you set that as the default notification type for your calendar on calendar.google.com. A built-in email option needs a small server and is on the roadmap.

## Build it yourself

Needs Node 22. Share intents and notifications are native code, so the app does not run in Expo Go.

```bash
npm install
npm run typecheck
npm test
```

### Development build in the cloud (no Android SDK needed)

EAS builds the development client on Expo's servers and gives you an APK to install.

```bash
npx eas-cli login
npx eas-cli init          # once: links the project and writes its id into app.json
npm run build:dev         # eas build --profile development --platform android
```

Install the APK from the link EAS prints, then run `npm start` on your computer and open the app on your phone. It finds the dev server on the same Wi-Fi, or scan the QR code in the terminal.

`npm run build:preview` makes a normal installable APK the same way. The **EAS dev build** workflow in GitHub Actions does the same from the Actions tab once you add an `EXPO_TOKEN` repository secret.

### Release APK on GitHub

GitHub Actions builds the APK for you. Every push to `main` produces a downloadable build artifact. To publish a release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The release APK is signed with the standard Android debug key so it installs without setup. That is fine for trying it out, but anyone can sign an APK with that key, so before sharing it widely create your own keystore (or let EAS manage one) and wire it in. Play also reviews apps that declare exact-alarm permissions, so declare your use case there.

### Previewing the UI in a browser

`npm run web` serves the interface in a browser for quick design work. Notifications, sharing and the date picker are Android-only and do nothing there.

## How it is built

Expo SDK 58 and React Native 0.88, TypeScript, local storage with AsyncStorage. `expo-notifications` schedules reminders and `expo-share-intent` receives shared links. The interface uses React Navigation's native stack, Reanimated 4 and Gesture Handler for motion and swipes, `expo-haptics` for touch feedback, and Fraunces with Manrope for type. It follows the phone's light or dark mode.

The parts worth reading are pure functions in `src/logic.ts` with tests in `test/logic.test.ts`: urgency buckets, the reminder ladder, date guessing, the WhatsApp parser and the home screen's headline.

```
src/logic.ts          buckets, reminder ladder, deadline guessing, WhatsApp import, home copy
src/notifications.ts  permission checks and scheduling
src/useStore.ts       items and settings, saved on every change
src/theme.ts          colours (light and dark), type, spacing, motion tokens
src/ui.tsx            text, buttons, chips, pills, cards, press feedback
src/SwipeRow.tsx      swipe right for applied, left to skip
src/toast.tsx         confirmation toasts with Undo
src/screens/          Home, ItemForm, Settings, Import
```

## Roadmap

- Email and WhatsApp reminders from a small server, as an opt-in
- A reminders log that shows which alerts were scheduled and which fired
- Per-item requirements (essay, CV, referee) that start reminders earlier
- A quick triage mode for working through imported links
- iOS

Issues and pull requests are welcome.

## License

MIT. See `LICENSE`.
