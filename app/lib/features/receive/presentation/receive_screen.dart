import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../../core/theme/app_theme.dart';
import '../../wallet/presentation/wallet_controller.dart';

/// Receive in dollars: show a QR (the wallet address as a deep link) so anyone
/// can send USDC. The Pix on-ramp (4P) plugs in here once that gate is live.
/// First screen that delivers value without an on-ramp.
class ReceiveScreen extends ConsumerWidget {
  const ReceiveScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final address = ref.watch(walletControllerProvider).valueOrNull?.address ?? '';
    final link = 'https://app.slippay.cc/pay?to=$address&asset=USDC';

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.bone,
        elevation: 0,
        title: const Text('Receber', style: TextStyle(color: AppColors.ink)),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              const SizedBox(height: 8),
              const Text(
                'Mostre este QR pra receber dólar.',
                style: TextStyle(fontSize: 18, color: AppColors.ink),
              ),
              const SizedBox(height: 32),
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(24),
                  border: Border.all(color: const Color(0x1F0A0A0A)),
                ),
                child: QrImageView(
                  data: link,
                  size: 240,
                  eyeStyle: const QrEyeStyle(
                    eyeShape: QrEyeShape.square,
                    color: AppColors.ink,
                  ),
                ),
              ),
              const SizedBox(height: 24),
              SelectableText(
                address,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 12,
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
