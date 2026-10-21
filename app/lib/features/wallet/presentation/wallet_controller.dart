import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../data/wallet_repository.dart';
import '../domain/wallet.dart';

/// DI: swap StubWalletRepository for StellarWalletRepository once the chain
/// adapter is wired and the testnet e2e passes.
final walletRepositoryProvider = Provider<WalletRepository>((ref) {
  return StubWalletRepository();
});

/// The connected wallet (null until created/connected). AsyncValue surfaces the
/// loading/error states to the UI without try/catch in widgets.
class WalletController extends AsyncNotifier<Wallet?> {
  @override
  Future<Wallet?> build() async {
    return ref.read(walletRepositoryProvider).current;
  }

  Future<void> create() async {
    state = const AsyncValue.loading();
    final repo = ref.read(walletRepositoryProvider);
    final res = await repo.create();
    state = res.match(
      (err) => AsyncValue.error(err, StackTrace.current),
      (wallet) => AsyncValue.data(wallet),
    );
  }

  Future<void> connect() async {
    state = const AsyncValue.loading();
    final repo = ref.read(walletRepositoryProvider);
    final res = await repo.connect();
    state = res.match(
      (err) => AsyncValue.error(err, StackTrace.current),
      (wallet) => AsyncValue.data(wallet),
    );
  }

  Future<void> disconnect() async {
    await ref.read(walletRepositoryProvider).disconnect();
    state = const AsyncValue.data(null);
  }
}

final walletControllerProvider =
    AsyncNotifierProvider<WalletController, Wallet?>(WalletController.new);

/// Convenience: is a wallet connected right now?
final isConnectedProvider = Provider<bool>((ref) {
  return ref.watch(walletControllerProvider).valueOrNull != null;
});
