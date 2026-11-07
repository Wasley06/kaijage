# Installing KAIJAGE POS

Tagged releases publish Windows, macOS, Android, and web app packages to the
GitHub Releases page. The `main` branch also publishes an installable web app
through GitHub Pages for iPhone and iPad users.

## Windows and macOS

Download the Windows `.exe` installer or macOS `.dmg` from Releases. These
packages are currently unsigned; Windows SmartScreen or macOS Gatekeeper may
show an operating-system warning. Production distribution should add an
organization code-signing certificate and Apple notarization credentials.

## Android

The release workflow builds a sideloadable debug APK. Android may ask users to
allow installation from their browser or file manager. A persistent Android
release keystore should be configured before publishing updates to existing
installations.

## iPhone and iPad

Open the GitHub Pages app URL in Safari, choose **Share**, then **Add to Home
Screen**. This installs the PWA without an App Store package. A signed IPA can
also be built by manually running the installer workflow with `build_ios` on
and these repository Actions secrets configured: `APPLE_CERTIFICATE_BASE64`,
`APPLE_CERTIFICATE_PASSWORD`, `APPLE_PROVISIONING_PROFILE_BASE64`,
`APPLE_TEAM_ID`, and `APPLE_EXPORT_OPTIONS_BASE64`. The certificate and profile
must authorize bundle ID `com.aelyn.kaijagepos`.

## Offline sign-in

Sign in successfully online once on each device. The app then saves an
encrypted workspace snapshot and a salted password verifier on that device.
Offline access is limited to the cached account and data on that device. The
server checks account status and synchronizes queued changes when the device is
online again.
