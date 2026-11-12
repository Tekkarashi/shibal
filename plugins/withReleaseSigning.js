/**
 * Signs release builds with Shibal's private key when CI provides it:
 *   SHIBAL_KEYSTORE           path to the PKCS#12 keystore
 *   SHIBAL_KEYSTORE_PASSWORD  its password (also the key's password)
 *   SHIBAL_KEY_ALIAS          the key's alias
 * Without those, release builds keep Expo's default (the public debug key), which is what
 * local builds and pull requests from forks get.
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const RELEASE_CONFIG = `
        release {
            if (System.getenv("SHIBAL_KEYSTORE")) {
                storeFile file(System.getenv("SHIBAL_KEYSTORE"))
                storeType "pkcs12"
                storePassword System.getenv("SHIBAL_KEYSTORE_PASSWORD")
                keyAlias System.getenv("SHIBAL_KEY_ALIAS")
                keyPassword System.getenv("SHIBAL_KEYSTORE_PASSWORD")
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let g = cfg.modResults.contents;
    if (g.includes('SHIBAL_KEYSTORE')) return cfg;
    if (!/signingConfigs\s*\{/.test(g)) throw new Error('withReleaseSigning: no signingConfigs block in app/build.gradle');
    g = g.replace(/signingConfigs\s*\{/, (m) => m + RELEASE_CONFIG);
    const before = g;
    g = g.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
      '$1signingConfig(System.getenv("SHIBAL_KEYSTORE") ? signingConfigs.release : signingConfigs.debug)',
    );
    if (g === before) throw new Error('withReleaseSigning: could not find the release signingConfig');
    cfg.modResults.contents = g;
    return cfg;
  });
};
