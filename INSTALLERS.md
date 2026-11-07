# Installing KAIJAGE POS

Tagged releases publish Windows, macOS, Android, and web app packages to the
GitHub Releases page. The `main` branch also publishes an installable web app
through GitHub Pages for iPhone and iPad users.

## App icon and desktop updates

`assets/icon-3d.svg` is the source identity used for Windows, macOS, Android,
iOS, and web app icons. New Windows and macOS releases publish Electron update
metadata and block maps alongside their installers. Windows desktop apps check
GitHub Releases while online, download updates automatically, and offer to
restart to install. Existing 1.0.1 and 1.0.2 Windows installs need a manual
upgrade to this release because those packages did not include the updater.
macOS updates require signing credentials
below. The web app updates through its service worker when users reopen it.

## Windows and macOS

Download the Windows `.exe` installer or macOS `.dmg` from Releases. These
packages are currently unsigned; Windows SmartScreen or macOS Gatekeeper may
show an operating-system warning. macOS automatic installation also requires a
Developer ID Application certificate from the same Apple Developer Team used
for every later update. Configure `MACOS_CERTIFICATE_P12_BASE64`,
`MACOS_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and
`APPLE_TEAM_ID` as repository Actions secrets to sign and notarize macOS
releases. Without those credentials, the macOS package is still published, but
macOS will not apply background updates to it.

## Android

The release workflow builds a sideloadable debug APK. Android may ask users to
allow installation from their browser or file manager. A persistent Android
release keystore and an in-app installer flow are required for automatic APK
updates; until those are configured, install the latest APK manually. Android
users can install the Pages PWA instead for automatic web app updates.

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
