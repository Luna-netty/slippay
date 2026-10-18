/// USDC + contract constants, mirrored verbatim from the web adapter
/// (apps/web/src/lib/chain/stellar/adapter.ts). An issuer lookalike is a phishing
/// vector, so these are hardcoded and must be verified against the web source,
/// never fetched or typed loosely.

enum StellarNetwork { testnet, public }

class StellarConstants {
  const StellarConstants._();

  /// Circle USDC issuer per network (verified against the web adapter).
  static const Map<StellarNetwork, String> usdcIssuer = {
    StellarNetwork.testnet: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    StellarNetwork.public: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  };

  /// Subscription contract = the SEP-41 recurring spender. Mainnet id.
  static const String subscriptionContractMainnet =
      'CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN';

  static const String assetCode = 'USDC';

  static StellarNetwork networkFromString(String s) =>
      s.toUpperCase() == 'PUBLIC' ? StellarNetwork.public : StellarNetwork.testnet;

  static String passphrase(StellarNetwork n) =>
      n == StellarNetwork.public
          ? 'Public Global Stellar Network ; September 2015'
          : 'Test SDF Network ; September 2015';
}
