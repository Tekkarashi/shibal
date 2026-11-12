/**
 * Everything lives in app.json; this only records which key signs the build, so the app
 * can tell whether a release signed with Shibal's private key can install over it
 * (see src/updates.ts). CI sets SHIBAL_KEYSTORE when it signs with that key.
 */
module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    signedWith: process.env.SHIBAL_KEYSTORE ? 'release' : 'debug',
  },
});
