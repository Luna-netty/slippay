import 'package:flutter/material.dart';

import '../../../core/config/app_config.dart';
import '../../../core/theme/app_theme.dart';

/// On-chain receipt for a settled payment. Mirrors web Comprovante.tsx. The tx
/// hash links to the public explorer: the proof is the chain, not our word.
class ReceiptScreen extends StatelessWidget {
  const ReceiptScreen({required this.txHash, super.key});

  final String txHash;

  String get _explorerUrl {
    final net = AppConfig.stellarNetwork == 'PUBLIC' ? 'public' : 'testnet';
    return 'https://stellar.expert/explorer/$net/tx/$txHash';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.bone,
        elevation: 0,
        title: const Text('Comprovante', style: TextStyle(color: AppColors.ink)),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              const SizedBox(height: 24),
              const Icon(Icons.check_circle, size: 72, color: AppColors.ok),
              const SizedBox(height: 16),
              const Text(
                'Pago.',
                style: TextStyle(fontSize: 32, fontWeight: FontWeight.w900, color: AppColors.ink),
              ),
              const SizedBox(height: 8),
              const Text(
                'Confirmado on-chain. Verificável por qualquer um.',
                style: TextStyle(fontSize: 15, color: AppColors.gray),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 32),
              _field('TX HASH', txHash),
              const Spacer(),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () {
                    // TODO(launch): url_launcher to _explorerUrl
                  },
                  child: const Text('VER NO EXPLORER'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _field(String label, String value) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: const TextStyle(
                fontFamily: 'monospace',
                fontSize: 10,
                letterSpacing: 2,
                color: AppColors.gray,
              )),
          const SizedBox(height: 6),
          SelectableText(value,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 12, color: AppColors.ink)),
        ],
      );
}
