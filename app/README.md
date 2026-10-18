# Slippay App (Flutter)

The Slippay mobile app for Android + iOS: a non-custodial Pix to USDC dollar
wallet on Stellar. Mirrors the web app, built to an elite Flutter standard.

## Status

Scaffold + v1 screens written by hand (Flutter was not installed on the build
machine). The pure-Dart core (money, chain port, theme, config, state) is solid;
the screens render; the on-chain signing path is stubbed behind a clean boundary.

Run it:

```bash
cd app
flutter pub get
flutter run --dart-define-from-file=config/dev.json
flutter test                                   # core money tests pass first
```

## Architecture

Feature-first clean architecture, Riverpod for state/DI, go_router for nav.

```
lib/
  main.dart            MaterialApp.router
  bootstrap.dart       runZonedGuarded + ProviderScope (+ Sentry when wired)
  core/
    config/            AppConfig (dart-define-from-file, no .env in the APK)
    money/             UsdcAmount (int minor units, never double) + tests
    chain/             chain_port.dart (mirrors web ChainAdapter) + stellar/usdc.dart
    theme/             BONE/INK/gold tokens
    router/            go_router + wallet-connected redirect guard
  features/
    wallet/            passkey wallet (create/connect), state machine, controller
    balance/           USDC balance screen
    receive/           QR receive
    pay/               scan + trusted confirm + (stubbed) biometric sign
test/                  unit tests (money first)
```

## The wallet (the hard part, honest)

Non-custodial passkey model: the secp256r1 key lives in the Secure Enclave (iOS)
/ StrongBox (Android), never exported, no seed phrase. The app holds only the
public address, credential id, and signatures.

`StubWalletRepository` lets the app boot and the flow be built/tested. The real
`StellarWalletRepository` (OZSmartAccountKit via `stellar_flutter_sdk`) is the
next milestone: a testnet create -> sign -> transfer e2e, with the WebAuthn
challenge bound to the tx hash (not a random nonce). See the build blueprint.

Critical correctness rule already encoded: the confirm UI must render the decoded
recipient + amount, because the biometric assertion proves presence, not intent.

## Security bar (OWASP MASVS L2, to enforce as the chain path lands)

- signing key non-exportable in the enclave; `__check_auth` on-chain is the only
  authorization (never a session/JWT)
- cert/pubkey pinning on relayer + Soroban RPC + 4P
- RASP hard refuse-to-sign on hostile runtime; server-side attestation gate
- FLAG_SECURE + app-switcher blur on balance/receive/confirm
- money as int minor units; chain is the source of truth

## Next

1. wire `StellarWalletRepository` (OZSmartAccountKit), testnet e2e
2. balance read on-chain (token contract `balance()`)
3. pay: parse QR -> checkReceiveAddress guard -> simulate -> sign -> submit
4. receipts, subscription, charge screens
5. security hardening + CI (Codemagic) + store submission (declare non-custodial)
