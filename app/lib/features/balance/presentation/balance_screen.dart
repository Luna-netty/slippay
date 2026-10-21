import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/money/usdc_amount.dart';
import '../../../core/theme/app_theme.dart';
import '../../wallet/presentation/wallet_controller.dart';

/// Home once connected. Shows the USDC balance (read via the token contract's
/// balance() for a C-address, never a G-account query) + receive/pay actions.
/// Balance read is stubbed until the chain adapter is wired.
class BalanceScreen extends ConsumerWidget {
  const BalanceScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wallet = ref.watch(walletControllerProvider).valueOrNull;
    // Stub balance until StellarWalletRepository reads it on-chain.
    final balance = UsdcAmount.zero;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.bone,
        elevation: 0,
        title: const Text(
          'slippay',
          style: TextStyle(fontWeight: FontWeight.w800, letterSpacing: -1, color: AppColors.ink),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout, color: AppColors.gray, size: 20),
            onPressed: () => ref.read(walletControllerProvider.notifier).disconnect(),
          ),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 24),
              const Text(
                'SEU SALDO · USDC',
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 10,
                  letterSpacing: 2.2,
                  color: AppColors.gray,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                '\$ ${balance.toHuman()}',
                style: const TextStyle(
                  fontSize: 56,
                  fontWeight: FontWeight.w900,
                  letterSpacing: -2,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                wallet?.address ?? '',
                style: const TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 11,
                  color: AppColors.gray,
                ),
                overflow: TextOverflow.ellipsis,
              ),
              const Spacer(),
              Row(
                children: [
                  Expanded(
                    child: FilledButton(
                      onPressed: () => context.push('/receive'),
                      child: const Text('RECEBER'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: FilledButton(
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.ink,
                        foregroundColor: AppColors.bone,
                      ),
                      onPressed: () => context.push('/pay'),
                      child: const Text('PAGAR'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 28),
            ],
          ),
        ),
      ),
    );
  }
}
