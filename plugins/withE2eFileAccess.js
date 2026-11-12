/**
 * Test builds only (SHIBAL_E2E=1, set by the e2e CI job): lets the app read files the
 * emulator's shell pushes to shared storage, so a share can be simulated without a real
 * sending app. On a phone the sender grants access to the file it shares instead, so the
 * APK people install never includes this permission.
 */
const { withAndroidManifest } = require('expo/config-plugins');

const PERMISSION = 'android.permission.MANAGE_EXTERNAL_STORAGE';

module.exports = function withE2eFileAccess(config) {
  if (process.env.SHIBAL_E2E !== '1') return config;
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const perms = manifest['uses-permission'] ?? [];
    if (!perms.some((p) => p.$?.['android:name'] === PERMISSION)) {
      perms.push({ $: { 'android:name': PERMISSION } });
    }
    manifest['uses-permission'] = perms;
    return cfg;
  });
};
