import '../money/usdc_amount.dart';

/// Chain-agnostic payment port. Mirrors the web `ChainAdapter` interface
/// (apps/web/src/lib/chain/types.ts) so the Stellar adapter (today) and a future
/// Solana adapter implement the same surface. The domain + UI talk only to this,
/// never to a chain SDK directly. Pure Dart: no flutter, no stellar_flutter_sdk.

enum ChainId { stellar, solana }

/// Onboarding guard for a receive address (mirror of AddressCheck on the web).
class AddressCheck {
  const AddressCheck({
    required this.validFormat,
    required this.accountExists,
    required this.hasUsdcTrustline,
  });

  /// Offline strkey/pubkey check. false => hard-block the save.
  final bool validFormat;

  /// true / false / null (null = network unknown, never assert).
  final bool? accountExists;

  /// Stellar: recipient has a USDC trustline. null when not determinable.
  final bool? hasUsdcTrustline;
}

class OneTimePayArgs {
  const OneTimePayArgs({
    required this.buyerAddress,
    required this.merchantAddress,
    required this.platformAddress,
    required this.amount,
    required this.platformFeeBp,
    required this.memoHex,
    required this.maxTime,
  });

  final String buyerAddress;
  final String merchantAddress;
  final String platformAddress;
  final UsdcAmount amount;
  final int platformFeeBp;

  /// 32-byte order id as hex (Stellar memo hash / Solana memo/ref).
  final String memoHex;

  /// Unix seconds; tx invalid after this.
  final int maxTime;
}

class ApproveArgs {
  const ApproveArgs({
    required this.buyerAddress,
    required this.cap,
    this.durationSecs,
  });

  final String buyerAddress;

  /// USDC cap the recurring debit may draw up to.
  final UsdcAmount cap;

  /// Authorization lifetime in seconds. Stellar maps it to ledgers; default ~9mo.
  final int? durationSecs;
}

class PayResult {
  const PayResult(this.hash);
  final String hash;
}

/// The port every chain adapter implements.
abstract interface class ChainPort {
  ChainId get id;

  /// Connect (passkey) and return the wallet's address (G... or C...).
  Future<String> connectWallet();

  /// Offline format check (no network).
  bool isValidAddress(String address);

  /// Network-backed receive-address guard (exists + trustline).
  Future<AddressCheck> checkReceiveAddress(String address);

  /// One-time split payment (merchant + platform fee) in one tx.
  Future<PayResult> payOneTime(OneTimePayArgs args);

  /// Recurring authorization up to a cap.
  Future<PayResult> approveRecurring(ApproveArgs args);
}
