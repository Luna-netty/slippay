import 'package:fpdart/fpdart.dart';
import '../domain/wallet.dart';

/// Error type for wallet ops (no exceptions across layers; return Either).
class WalletError {
  const WalletError(this.message, {this.cause});
  final String message;
  final Object? cause;
  @override
  String toString() => 'WalletError($message)';
}

/// The wallet boundary. The concrete Stellar implementation creates/connects a
/// passkey smart-account and signs Soroban txs whose WebAuthn challenge is bound
/// to the tx hash. This interface keeps the UI + domain free of the chain SDK.
abstract interface class WalletRepository {
  /// Create a brand-new passkey wallet (Face ID / fingerprint enrollment),
  /// deploy the smart-account, and (on testnet) fund via the relayer.
  Future<Either<WalletError, Wallet>> create();

  /// Connect an existing passkey wallet on this device.
  Future<Either<WalletError, Wallet>> connect();

  /// The currently connected wallet, if any.
  Wallet? get current;

  /// Forget the local session (does NOT touch on-chain funds; the key stays in
  /// the enclave, re-connectable).
  Future<void> disconnect();
}

/// Dev stub: lets the app boot, render onboarding, and exercise the flow without
/// the chain SDK wired. Replace with StellarWalletRepository (OZSmartAccountKit)
/// once the testnet create->sign->transfer e2e passes (blueprint milestone).
///
/// HONEST GAP: this does not create a real on-chain account. It returns a
/// placeholder so the UI/state machine can be built and tested first.
class StubWalletRepository implements WalletRepository {
  Wallet? _current;

  @override
  Wallet? get current => _current;

  @override
  Future<Either<WalletError, Wallet>> create() async {
    await Future<void>.delayed(const Duration(milliseconds: 400));
    _current = const Wallet(
      address: 'C_STUB_NOT_A_REAL_ACCOUNT',
      credentialId: 'stub-credential',
      deployed: false,
    );
    return Right(_current!);
  }

  @override
  Future<Either<WalletError, Wallet>> connect() async {
    if (_current == null) {
      return const Left(WalletError('no wallet on this device'));
    }
    return Right(_current!);
  }

  @override
  Future<void> disconnect() async => _current = null;
}
