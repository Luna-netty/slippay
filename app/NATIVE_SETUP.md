# Native setup (Android + iOS)

The passkey wallet and payment deep links only work once the domain-association
files are live and the placeholders below are filled with your real dev-account
IDs. Do this when you have the Apple Developer + Google Play accounts.

## 1. Apple (iOS)

- **Team ID**: from developer.apple.com → Membership. Replace `TEAMID` in
  `apps/web/public/.well-known/apple-app-site-association` with it
  (e.g. `A1B2C3D4E5.cc.slippay.app`).
- The AASA must be served at `https://app.slippay.cc/.well-known/apple-app-site-association`
  with `Content-Type: application/json`, no redirect, no `.json` extension.
- `Runner.entitlements` already declares `webcredentials:app.slippay.cc` (passkeys)
  and `applinks:app.slippay.cc` (deep links). Enable the Associated Domains
  capability in Xcode and set the bundle id to `cc.slippay.app`.
- iOS 16+ for passkeys; graceful no-op below.

## 2. Android (Google Play)

- Enable **Play App Signing**. From Play Console → App Integrity, copy the
  **SHA-256 certificate fingerprint** and replace
  `REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT` in
  `apps/web/public/.well-known/assetlinks.json`.
- The assetlinks.json must be served at `https://app.slippay.cc/.well-known/assetlinks.json`.
- `AndroidManifest.xml` already declares the `autoVerify` deep-link filter and the
  CredentialManager-capable minSdk 28.
- Package id: `cc.slippay.app` (flavors add `.dev` suffix).

## 3. RP_ID

Both platforms bind passkeys to `app.slippay.cc` (the `RP_ID` in config). It MUST
match the domain hosting the two well-known files. Changing it later strands every
credential, so keep it stable.

## 4. Store declarations (compliance)

- **Google Play**: declare the app **non-custodial** (the user holds the key; the
  app never custodies funds). Non-custodial wallets are out of scope of Play's
  Crypto Exchanges/Software Wallets licensing policy. Fill the Financial-features
  + Data-safety forms accordingly.
- **App Store**: `ITSAppUsesNonExemptEncryption=false` is set (standard TLS only);
  export-compliance is satisfied.

## 5. Build flavors

```bash
flutter run   --flavor dev  --dart-define-from-file=config/dev.json
flutter build appbundle --flavor prod --dart-define-from-file=config/prod.json --obfuscate --split-debug-info=build/symbols
flutter build ipa       --flavor prod --dart-define-from-file=config/prod.json --obfuscate --split-debug-info=build/symbols
```
