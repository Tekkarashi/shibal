/**
 * Keeps a share that arrives while Shibal is being brought back after Android killed it.
 *
 * When Shibal's process has died but its task is still in recent apps, a share from another
 * app brings that task back: Android recreates MainActivity with its old launcher intent and
 * hands the share over through onNewIntent. Expo drops onNewIntent until the app has loaded,
 * so expo-share-intent never sees it and Shibal opens on the home screen with nothing.
 *
 * This saves the share where expo-share-intent already looks when the app starts, before
 * Expo gets a chance to drop it. When the app is running, the module handles the share at
 * once and clears that copy (patches/expo-share-intent+9.0.0.patch), so nothing arrives twice.
 */
const { withMainActivity } = require('expo/config-plugins');

const MARKER = 'Shibal: keep shares that arrive while the app is starting';

const OVERRIDE = `
  // ${MARKER} (plugins/withShareOnNewIntent.js)
  override fun onNewIntent(intent: Intent) {
    if (intent.type != null) {
      ExpoShareIntentSingleton.intent = intent
      ExpoShareIntentSingleton.isPending = true
    }
    super.onNewIntent(intent)
  }
`;

function addImport(src, name) {
  if (new RegExp(`^import ${name.replace(/\./g, '\\.')}$`, 'm').test(src)) return src;
  return src.replace(/^(package [^\n]+\n)/, `$1\nimport ${name}\n`);
}

module.exports = function withShareOnNewIntent(config) {
  return withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') throw new Error('withShareOnNewIntent: expected a Kotlin MainActivity');
    let src = cfg.modResults.contents;
    if (src.includes(MARKER)) return cfg;
    if (/fun onNewIntent\s*\(/.test(src)) throw new Error('withShareOnNewIntent: MainActivity already overrides onNewIntent; merge by hand');
    const classOpen = /class MainActivity\s*:\s*ReactActivity\(\)\s*\{\n/;
    if (!classOpen.test(src)) throw new Error('withShareOnNewIntent: could not find the MainActivity class');
    src = addImport(src, 'android.content.Intent');
    src = addImport(src, 'expo.modules.shareintent.ExpoShareIntentSingleton');
    src = src.replace(classOpen, (m) => m + OVERRIDE);
    cfg.modResults.contents = src;
    return cfg;
  });
};
