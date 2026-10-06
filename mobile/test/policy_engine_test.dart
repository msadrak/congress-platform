import 'package:test/test.dart';
import 'package:congress_scanner_mobile/models/checkin_point.dart';
import 'package:congress_scanner_mobile/models/manifest_ticket.dart';
import 'package:congress_scanner_mobile/services/policy_engine.dart';

void main() {
  group('PolicyEngine evaluation', () {
    test('MULTI_ENTRY allows repeated scans', () {
      final point = CheckInPoint(
        id: 'p1',
        eventId: 'e1',
        name: 'Main Gate',
        policyType: 'MULTI_ENTRY',
      );

      final tickets = <String, ManifestTicket>{
        'secret_1': ManifestTicket(
          qrSecret: 'secret_1',
          ticketId: 't1',
          attendeeName: 'Dr. Ali',
          attendeeEmail: 'ali@example.com',
          ticketTierId: 'tier_1',
          ticketTierName: 'General',
        ),
      };

      final res1 = PolicyEngine.evaluate(
        tickets: tickets,
        point: point,
        rawSecret: 'secret_1',
      );
      expect(res1.status, 'ADMITTED');
      expect(res1.isAdmitted, isTrue);
      expect(tickets['secret_1']!.admissionCount, 1);

      // Second scan also admitted
      final res2 = PolicyEngine.evaluate(
        tickets: tickets,
        point: point,
        rawSecret: 'secret_1',
      );
      expect(res2.status, 'ADMITTED');
      expect(tickets['secret_1']!.admissionCount, 2);
    });

    test('SINGLE_USE rejects second scan with ALREADY_ADMITTED', () {
      final point = CheckInPoint(
        id: 'p2',
        eventId: 'e1',
        name: 'Dining Hall',
        policyType: 'SINGLE_USE',
      );

      final tickets = <String, ManifestTicket>{
        'lunch_pass': ManifestTicket(
          qrSecret: 'lunch_pass',
          ticketId: 't2',
          attendeeName: 'Sara',
          attendeeEmail: 'sara@example.com',
          ticketTierId: 'tier_1',
          ticketTierName: 'General',
        ),
      };

      final res1 = PolicyEngine.evaluate(
        tickets: tickets,
        point: point,
        rawSecret: 'lunch_pass',
      );
      expect(res1.status, 'ADMITTED');
      expect(tickets['lunch_pass']!.isAdmitted, isTrue);

      // Second scan rejected
      final res2 = PolicyEngine.evaluate(
        tickets: tickets,
        point: point,
        rawSecret: 'lunch_pass',
      );
      expect(res2.status, 'REJECTED');
      expect(res2.rejectionReason, 'ALREADY_ADMITTED');
      expect(res2.isRejected, isTrue);
    });

    test('TIER_RESTRICTED enforces allowed tiers whitelist', () {
      final point = CheckInPoint(
        id: 'p3',
        eventId: 'e1',
        name: 'VIP Entrance',
        policyType: 'TIER_RESTRICTED',
        allowedTierIds: ['vip_tier_id'],
      );

      final tickets = <String, ManifestTicket>{
        'vip_secret': ManifestTicket(
          qrSecret: 'vip_secret',
          ticketId: 't_vip',
          attendeeName: 'VIP Attendee',
          attendeeEmail: 'vip@example.com',
          ticketTierId: 'vip_tier_id',
          ticketTierName: 'VIP',
        ),
        'gen_secret': ManifestTicket(
          qrSecret: 'gen_secret',
          ticketId: 't_gen',
          attendeeName: 'General Attendee',
          attendeeEmail: 'gen@example.com',
          ticketTierId: 'gen_tier_id',
          ticketTierName: 'General',
        ),
      };

      final resVip = PolicyEngine.evaluate(
        tickets: tickets,
        point: point,
        rawSecret: 'vip_secret',
      );
      expect(resVip.status, 'ADMITTED');

      final resGen = PolicyEngine.evaluate(
        tickets: tickets,
        point: point,
        rawSecret: 'gen_secret',
      );
      expect(resGen.status, 'REJECTED');
      expect(resGen.rejectionReason, 'TIER_NOT_ALLOWED');
    });

    test('Invalid secret returns INVALID_TICKET', () {
      final point = CheckInPoint(
        id: 'p4',
        eventId: 'e1',
        name: 'Gate',
      );
      final tickets = <String, ManifestTicket>{};

      final res = PolicyEngine.evaluate(
        tickets: tickets,
        point: point,
        rawSecret: 'forged_fake_secret',
      );
      expect(res.status, 'REJECTED');
      expect(res.rejectionReason, 'INVALID_TICKET');
    });

    test('CAPACITY_CAPPED rejects when room limit reached', () {
      final point = CheckInPoint(
        id: 'p5',
        eventId: 'e1',
        name: 'Room 101',
        policyType: 'CAPACITY_CAPPED',
        maxCapacity: 10,
      );

      final tickets = <String, ManifestTicket>{
        'pass_ok': ManifestTicket(
          qrSecret: 'pass_ok',
          ticketId: 't_ok',
          attendeeName: 'Admitted Person',
          attendeeEmail: 'ok@example.com',
          ticketTierId: 'tier_1',
          ticketTierName: 'General',
        ),
      };

      // Under capacity (9 admitted)
      final res1 = PolicyEngine.evaluate(
        tickets: tickets,
        point: point,
        rawSecret: 'pass_ok',
        currentAdmittedCount: 9,
      );
      expect(res1.status, 'ADMITTED');

      // At capacity (10 admitted)
      final res2 = PolicyEngine.evaluate(
        tickets: tickets,
        point: point,
        rawSecret: 'pass_ok',
        currentAdmittedCount: 10,
      );
      expect(res2.status, 'REJECTED');
      expect(res2.rejectionReason, 'CAPACITY_REACHED');
    });
  });
}
