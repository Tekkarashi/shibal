/**
 * Decides what Shibal appears for in Android's share sheet, and what it is
 * called there.
 *
 * expo-share-intent only offers text/* (plus a fixed list). WhatsApp mostly
 * shares images (flyers) and, for "Export chat", a .zip, so Shibal never showed
 * up there. This replaces the share filters on the main activity with one set
 * labelled "Save to Shibal".
 *
 * List this plugin BEFORE expo-share-intent in app.json: Expo runs manifest
 * mods last-registered-first, so being listed first means it runs last and
 * sees (and replaces) the filters expo-share-intent added.
 */
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const SEND = 'android.intent.action.SEND';
const SEND_MULTIPLE = 'android.intent.action.SEND_MULTIPLE';

const filter = (action, label, mimeTypes) => ({
  $: { 'android:label': label },
  action: [{ $: { 'android:name': action } }],
  category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
  data: mimeTypes.map((m) => ({ $: { 'android:mimeType': m } })),
});

module.exports = function withShareTargets(config, options = {}) {
  const label = options.label ?? 'Save to Shibal';
  const single = options.mimeTypes ?? ['text/*', 'image/*', 'application/zip', 'application/x-zip-compressed'];
  const multiple = options.multipleMimeTypes ?? ['image/*'];

  return withAndroidManifest(config, (cfg) => {
    const main = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults);
    const isShare = (f) => (f.action ?? []).some((a) => [SEND, SEND_MULTIPLE].includes(a.$?.['android:name']));
    main['intent-filter'] = [
      ...(main['intent-filter'] ?? []).filter((f) => !isShare(f)),
      filter(SEND, label, single),
      filter(SEND_MULTIPLE, label, multiple),
    ];
    return cfg;
  });
};
