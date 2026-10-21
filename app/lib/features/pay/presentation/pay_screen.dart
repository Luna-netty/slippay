import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../../core/theme/app_theme.dart';

/// Pay: scan a QR, then a TRUSTED confirm sheet shows the decoded recipient +
/// amount (the WebAuthn assertion proves presence, NOT intent, so OUR app must
/// render the intent), then biometric sign -> fee-bump -> submit. The signing
/// path is stubbed until the chain adapter is wired; the scan + confirm UI is real.
class PayScreen extends ConsumerStatefulWidget {
  const PayScreen({super.key});

  @override
  ConsumerState<PayScreen> createState() => _PayScreenState();
}

class _PayScreenState extends ConsumerState<PayScreen> {
  String? _scanned;
  bool _handled = false;

  void _onDetect(BarcodeCapture capture) {
    if (_handled) return;
    final raw = capture.barcodes.firstOrNull?.rawValue;
    if (raw == null) return;
    setState(() {
      _handled = true;
      _scanned = raw;
    });
    _showConfirm(raw);
  }

  Future<void> _showConfirm(String payload) async {
    // TODO(chain): parse payload (to=, amount=, asset=), then checkReceiveAddress
    // via ChainPort (recipient-redirection guard) before showing this sheet.
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.bone,
      builder: (_) => Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'CONFIRME O PAGAMENTO',
              style: TextStyle(
                fontFamily: 'monospace',
                fontSize: 10,
                letterSpacing: 2,
                color: AppColors.gray,
              ),
            ),
            const SizedBox(height: 16),
            Text(
              payload,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 12, color: AppColors.ink),
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () {
                  // TODO(chain): build+simulate tx, derive WebAuthn challenge from
                  // tx hash, biometric assertion, fee-bump, submit. Then /receipt.
                  Navigator.of(context).pop();
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('assinatura on-chain: pendente do chain adapter')),
                  );
                },
                child: const Text('AUTORIZAR COM A BIOMETRIA'),
              ),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: () {
                Navigator.of(context).pop();
                setState(() => _handled = false);
              },
              child: const Text('cancelar', style: TextStyle(color: AppColors.gray)),
            ),
          ],
        ),
      ),
    );
    if (mounted) setState(() => _handled = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.bone,
        elevation: 0,
        title: const Text('Pagar', style: TextStyle(color: AppColors.ink)),
      ),
      body: Stack(
        children: [
          MobileScanner(onDetect: _onDetect),
          Positioned(
            bottom: 40,
            left: 0,
            right: 0,
            child: Text(
              _scanned == null ? 'aponte pra um QR de pagamento' : 'lido',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white, fontSize: 14),
            ),
          ),
        ],
      ),
    );
  }
}
