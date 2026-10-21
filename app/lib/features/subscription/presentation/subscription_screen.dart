import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/money/usdc_amount.dart';
import '../../../core/theme/app_theme.dart';

/// Recurring authorization: the owner approves a spending cap that a recurring
/// debit may draw up to, enforced on-chain by the subscription contract (the
/// SEP-41 spender). Mirrors web Sub / PolicySubscribe. The cap + duration are the
/// guardrail: the agent/merchant can never exceed them.
class SubscriptionScreen extends ConsumerStatefulWidget {
  const SubscriptionScreen({super.key});

  @override
  ConsumerState<SubscriptionScreen> createState() => _SubscriptionScreenState();
}

class _SubscriptionScreenState extends ConsumerState<SubscriptionScreen> {
  final _capController = TextEditingController(text: '12.00');
  String? _error;

  @override
  void dispose() {
    _capController.dispose();
    super.dispose();
  }

  void _approve() {
    setState(() => _error = null);
    try {
      final cap = UsdcAmount.parse(_capController.text);
      if (cap == UsdcAmount.zero) {
        setState(() => _error = 'defina um limite maior que zero');
        return;
      }
      // TODO(chain): approveRecurring(ApproveArgs(cap: cap, durationSecs: ...))
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('autorizar até \$${cap.toHuman()}: pendente do chain adapter')),
      );
    } on FormatException {
      setState(() => _error = 'valor inválido');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.bone,
        elevation: 0,
        title: const Text('Autorização recorrente', style: TextStyle(color: AppColors.ink)),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 8),
              const Text(
                'Você define o teto.\nNunca passa disso.',
                style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: AppColors.ink, height: 1.05),
              ),
              const SizedBox(height: 14),
              const Text(
                'A cobrança recorrente só pode sacar até o limite que você aprovar, '
                'travado no contrato on-chain. Acima disso, trava.',
                style: TextStyle(fontSize: 15, color: AppColors.gray, height: 1.4),
              ),
              const SizedBox(height: 32),
              const Text('LIMITE MENSAL · USDC',
                  style: TextStyle(fontFamily: 'monospace', fontSize: 10, letterSpacing: 2, color: AppColors.gray)),
              const SizedBox(height: 8),
              TextField(
                controller: _capController,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w800, color: AppColors.ink),
                decoration: InputDecoration(
                  prefixText: '\$ ',
                  errorText: _error,
                  border: const UnderlineInputBorder(),
                ),
              ),
              const Spacer(),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _approve,
                  child: const Text('AUTORIZAR COM A BIOMETRIA'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
