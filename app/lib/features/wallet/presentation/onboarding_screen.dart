import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_theme.dart';
import 'wallet_controller.dart';

/// First screen. Create a biometric (passkey) wallet, no seed phrase. Mirrors the
/// web Login/Signup + /account create flow. Blocks everything: no wallet, no app.
class OnboardingScreen extends ConsumerWidget {
  const OnboardingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(walletControllerProvider);
    final loading = state.isLoading;

    ref.listen(walletControllerProvider, (_, next) {
      if (next.valueOrNull != null && context.mounted) context.go('/balance');
    });

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(28, 0, 28, 28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Spacer(),
              const Text(
                'AO VIVO · MAINNET STELLAR',
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 10,
                  letterSpacing: 2.4,
                  color: AppColors.gray,
                ),
              ),
              const SizedBox(height: 18),
              const Text(
                'Seus dólares,\nno Pix.',
                style: TextStyle(
                  fontSize: 44,
                  height: 0.95,
                  fontWeight: FontWeight.w900,
                  letterSpacing: -1.5,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: 20),
              const Text(
                'Uma conta em dólar que ninguém congela. '
                'A sua biometria é a chave, sem seed phrase, sem senha.',
                style: TextStyle(fontSize: 17, height: 1.5, color: AppColors.gray),
              ),
              const Spacer(),
              if (state.hasError)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Text(
                    'Não deu pra criar a carteira. Tente de novo.',
                    style: const TextStyle(color: AppColors.leak, fontSize: 13),
                  ),
                ),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: loading
                      ? null
                      : () => ref.read(walletControllerProvider.notifier).create(),
                  child: loading
                      ? const SizedBox(
                          height: 18,
                          width: 18,
                          child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.ink),
                        )
                      : const Text('CRIAR MINHA CARTEIRA'),
                ),
              ),
              const SizedBox(height: 12),
              TextButton(
                onPressed: loading
                    ? null
                    : () => ref.read(walletControllerProvider.notifier).connect(),
                child: const Text(
                  'já tenho conta neste aparelho',
                  style: TextStyle(color: AppColors.gray, fontSize: 12, letterSpacing: 1),
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'biometria · sem cartão · sem seed phrase',
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 10,
                  letterSpacing: 1.8,
                  color: AppColors.gray,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
