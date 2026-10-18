import 'package:flutter_test/flutter_test.dart';
import 'package:slippay/core/money/usdc_amount.dart';

void main() {
  group('UsdcAmount.parse', () {
    test('parses whole dollars to 7-decimal minor units', () {
      expect(UsdcAmount.parse('1').minor, BigInt.from(10000000));
      expect(UsdcAmount.parse('12.50').minor, BigInt.from(125000000));
    });

    test('parses full 7-decimal precision', () {
      expect(UsdcAmount.parse('0.0000001').minor, BigInt.one);
    });

    test('rejects more than 7 decimal places', () {
      expect(() => UsdcAmount.parse('0.00000001'), throwsFormatException);
    });

    test('rejects negative', () {
      expect(() => UsdcAmount.parse('-1'), throwsFormatException);
    });
  });

  group('UsdcAmount.fromMinor', () {
    test('builds from a chain minor-unit string', () {
      expect(UsdcAmount.fromMinor('125000000'), UsdcAmount.parse('12.5'));
    });
  });

  group('toHuman', () {
    test('trims trailing zeros, keeps 2 min', () {
      expect(UsdcAmount.parse('12.50').toHuman(), '12.50');
      expect(UsdcAmount.parse('12.3456700').toHuman(), '12.34567');
      expect(UsdcAmount.parse('1').toHuman(), '1.00');
      expect(UsdcAmount.zero.toHuman(), '0.00');
    });
  });

  group('arithmetic', () {
    test('add/subtract/compare in minor units', () {
      final a = UsdcAmount.parse('10');
      final b = UsdcAmount.parse('2.5');
      expect((a + b).toHuman(), '12.50');
      expect((a - b).toHuman(), '7.50');
      expect(a > b, isTrue);
      expect(b < a, isTrue);
    });

    test('round-trips through minor string with no float drift', () {
      final a = UsdcAmount.parse('0.1') + UsdcAmount.parse('0.2');
      expect(a.toHuman(), '0.30'); // the classic 0.1+0.2 float trap, avoided
      expect(a.toMinorString(), '3000000');
    });
  });
}
