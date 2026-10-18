import 'package:decimal/decimal.dart';

/// USDC amount as integer minor units (7 decimals on Stellar = "stroops" for the
/// asset). Money is NEVER a double; float in money is a bug. All arithmetic and
/// transport use the integer; humans see a formatted string.
///
/// Stellar assets carry 7 decimal places, so 1 USDC == 10,000,000 minor units.
class UsdcAmount implements Comparable<UsdcAmount> {
  const UsdcAmount(this.minor);

  /// Minor units (10^-7 USDC). Always an integer, never negative for a balance.
  final BigInt minor;

  static const int decimals = 7;
  static final BigInt _scale = BigInt.from(10).pow(decimals);

  static final UsdcAmount zero = UsdcAmount(BigInt.zero);

  /// Build from a raw minor-unit string/int (what the chain returns).
  factory UsdcAmount.fromMinor(Object value) {
    final b = value is BigInt ? value : BigInt.parse(value.toString());
    return UsdcAmount(b);
  }

  /// Parse a human string like "12.50" or "12.5000000" into minor units.
  /// Throws [FormatException] on a malformed amount or > 7 decimal places.
  factory UsdcAmount.parse(String human) {
    final d = Decimal.parse(human.trim());
    if (d.isNegative) {
      throw const FormatException('amount cannot be negative');
    }
    final scaled = d * Decimal.fromBigInt(_scale);
    if (!scaled.isInteger) {
      throw const FormatException('amount has more than 7 decimal places');
    }
    return UsdcAmount(scaled.toBigInt());
  }

  /// Human string with up to 7 decimals, trailing zeros trimmed (min 2 shown).
  String toHuman({int minFractionDigits = 2}) {
    final whole = minor ~/ _scale;
    final frac = (minor % _scale).toString().padLeft(decimals, '0');
    var trimmed = frac.replaceFirst(RegExp(r'0+$'), '');
    if (trimmed.length < minFractionDigits) {
      trimmed = trimmed.padRight(minFractionDigits, '0');
    }
    return trimmed.isEmpty ? '$whole' : '$whole.$trimmed';
  }

  /// The exact integer string the chain expects (minor units).
  String toMinorString() => minor.toString();

  UsdcAmount operator +(UsdcAmount o) => UsdcAmount(minor + o.minor);
  UsdcAmount operator -(UsdcAmount o) => UsdcAmount(minor - o.minor);
  bool operator >(UsdcAmount o) => minor > o.minor;
  bool operator <(UsdcAmount o) => minor < o.minor;

  @override
  int compareTo(UsdcAmount o) => minor.compareTo(o.minor);

  @override
  bool operator ==(Object o) => o is UsdcAmount && o.minor == minor;

  @override
  int get hashCode => minor.hashCode;

  @override
  String toString() => 'UsdcAmount(${toHuman()})';
}
