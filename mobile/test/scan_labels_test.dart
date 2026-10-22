import 'package:test/test.dart';
import 'package:congress_scanner_mobile/services/scan_labels.dart';

void main() {
  group('scan labels', () {
    test('maps every policy-engine rejection code to operator wording', () {
      expect(reasonLabel('INVALID_TICKET'), 'Not a ticket for this event');
      expect(reasonLabel('ALREADY_ADMITTED'),
          'Already checked in — send to help desk');
      expect(reasonLabel('TIER_NOT_ALLOWED'),
          'Ticket type not allowed at this gate');
      expect(reasonLabel('CAPACITY_REACHED'), 'Gate is full');
    });

    test('never shows a raw enum for unknown or missing codes', () {
      expect(reasonLabel(null), isNot(contains('_')));
      expect(reasonLabel('SOMETHING_NEW'), isNot(contains('_')));
    });

    test('maps policy types to plain names', () {
      expect(policyLabel('SINGLE_USE'), 'Single entry');
      expect(policyLabel('multi_entry'), 'Multi-entry');
      expect(policyLabel('TIER_RESTRICTED'), isNot(contains('_')));
      expect(policyLabel('CAPACITY_CAPPED'), isNot(contains('_')));
    });
  });
}
