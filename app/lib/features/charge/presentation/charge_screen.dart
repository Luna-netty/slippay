import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../../core/money/usdc_amount.dart';
import '../../../core/theme/app_theme.dart';
import '../../wallet/presentation/wallet_controller.dart';

/// Charge: generate a payment request QR for a specific amount. Mirrors web
/// Cobrar.tsx. The payer scans it on their Pay screen.
class ChargeScreen extends ConsumerStatefulWidget {
  const ChargeScreen({super.key});

  @override
  ConsumerState<ChargeScreen> createState() => _ChargeScreenState();
}

class _ChargeScreenState extends ConsumerState<ChargeScreen> {
  final _amountController = TextEditingController();
  UsdcAmount? _amount;
  String? _error;

  @override
  void dispose() {
    _amountController.dispose();
    super.dispose();
  }

  void _generate() {
    setState(() => _error = null);
    try {
      final a = UsdcAmount.parse(_amountController.text);
      if (a == UsdcAmount.zero) {
        setState(() => _error = 'informe um valor');
        return;
      }
      setState(() => _amount = a);
    } on FormatException {
      setState(() => _error = 'valor inválido');
    }
  }

  @override
  Widget build(BuildContext context) {
    final address = ref.watch(walletControllerProvider).valueOrNull?.address ?? '';
    final link = _amount == null
        ? null
        : 'https://app.slippay.cc/pay?to=$address&amount=${_amount!.toHuman()}&asset=USDC';

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.bone,
        elevation: 0,
        title: const Text('Cobrar', style: TextStyle(color: AppColors.ink)),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              if (link == null) ...[
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerLeft,
                  child: const Text('QUANTO COBRAR · USDC',
                      style: TextStyle(
                          fontFamily: 'monospace', fontSize: 10, letterSpacing: 2, color: AppColors.gray)),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _amountController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  style: const TextStyle(fontSize: 40, fontWeight: FontWeight.w800, color: AppColors.ink),
                  decoration: InputDecoration(
                    prefixText: '\$ ',
                    errorText: _error,
                    border: const UnderlineInputBorder(),
                  ),
                ),
                const Spacer(),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(onPressed: _generate, child: const Text('GERAR QR DE COBRANÇA')),
                ),
              ] else ...[
                const SizedBox(height: 16),
                Text('\$ ${_amount!.toHuman()}',
                    style: const TextStyle(fontSize: 40, fontWeight: FontWeight.w900, color: AppColors.ink)),
                const SizedBox(height: 24),
                Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(24),
                    border: Border.all(color: const Color(0x1F0A0A0A)),
                  ),
                  child: QrImageView(data: link, size: 240),
                ),
                const Spacer(),
                TextButton(
                  onPressed: () => setState(() => _amount = null),
                  child: const Text('cobrar outro valor', style: TextStyle(color: AppColors.gray)),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
