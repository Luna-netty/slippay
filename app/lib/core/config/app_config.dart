/// Runtime config, injected at build via --dart-define-from-file=config/<flavor>.json.
/// Never use a .env file (it ships readable in the APK). Values come from
/// String.fromEnvironment, so they are compile-time constants per flavor.
class AppConfig {
  const AppConfig._();

  static const String flavor = String.fromEnvironment('FLAVOR', defaultValue: 'dev');
  static const String chain = String.fromEnvironment('CHAIN', defaultValue: 'stellar');
  static const String stellarNetwork =
      String.fromEnvironment('STELLAR_NETWORK', defaultValue: 'TESTNET');
  static const String sorobanRpc = String.fromEnvironment(
    'SOROBAN_RPC',
    defaultValue: 'https://soroban-testnet.stellar.org',
  );
  static const String horizonUrl = String.fromEnvironment(
    'HORIZON_URL',
    defaultValue: 'https://horizon-testnet.stellar.org',
  );
  static const String networkPassphrase = String.fromEnvironment(
    'NETWORK_PASSPHRASE',
    defaultValue: 'Test SDF Network ; September 2015',
  );

  /// WebAuthn relying-party id. MUST match the domain hosting
  /// apple-app-site-association + assetlinks.json, or every passkey strands.
  static const String rpId = String.fromEnvironment('RP_ID', defaultValue: 'app.slippay.cc');

  static const String apiBase =
      String.fromEnvironment('API_BASE', defaultValue: 'https://api.slippay.cc/api');
  static const String relayerUrl = String.fromEnvironment('RELAYER_URL', defaultValue: '');
  static const String sentryDsn = String.fromEnvironment('SENTRY_DSN', defaultValue: '');

  static bool get isProd => flavor == 'prod';
}
