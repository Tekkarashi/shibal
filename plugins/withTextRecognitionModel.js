/**
 * Flyer reading uses Google's on-device text recognition through Play services, which keeps
 * the model out of the APK. This tag asks Play to download the model when Shibal is installed,
 * so the first shared flyer can be read straight away instead of waiting for a download.
 */
const { withAndroidManifest } = require('expo/config-plugins');

const NAME = 'com.google.mlkit.vision.DEPENDENCIES';

module.exports = function withTextRecognitionModel(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) return cfg;
    const meta = app['meta-data'] ?? [];
    const existing = meta.find((m) => m.$?.['android:name'] === NAME);
    if (existing) {
      const values = new Set(String(existing.$['android:value'] ?? '').split(',').filter(Boolean));
      values.add('ocr');
      existing.$['android:value'] = [...values].join(',');
    } else {
      meta.push({ $: { 'android:name': NAME, 'android:value': 'ocr' } });
    }
    app['meta-data'] = meta;
    return cfg;
  });
};
