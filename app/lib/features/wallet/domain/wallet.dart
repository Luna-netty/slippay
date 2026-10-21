/// A connected non-custodial wallet. The signing key never leaves the Secure
/// Enclave / StrongBox; the app only ever holds the public address, the
/// credential id, and signatures. There is no seed phrase in the passkey model.
class Wallet {
  const Wallet({
    required this.address,
    required this.credentialId,
    this.deployed = false,
  });

  /// Stellar address: a contract C-address for a smart (passkey) account.
  final String address;

  /// The WebAuthn credential id bound to this wallet's signer (opaque).
  final String credentialId;

  /// Whether the smart-account contract is deployed on-chain yet.
  final bool deployed;

  Wallet copyWith({String? address, String? credentialId, bool? deployed}) => Wallet(
        address: address ?? this.address,
        credentialId: credentialId ?? this.credentialId,
        deployed: deployed ?? this.deployed,
      );
}

/// Explicit signing state machine (the blueprint's audit-trail option). Every
/// money move walks idle -> building -> awaitingBiometric -> signing ->
/// submitting -> settled | failed. No hidden steps.
enum SignPhase { idle, building, awaitingBiometric, signing, submitting, settled, failed }
