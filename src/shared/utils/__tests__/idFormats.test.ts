import {
  buildAgentId,
  buildChatSessionId,
  buildScheduleJobId,
  buildTimestampSegment,
  extractMonthFromChatSessionIdValue,
  isValidChatSessionIdFormat,
  normalizeDeviceIdSegment,
} from '../idFormats';

describe('idFormats', () => {
  const fixedDate = new Date(2026, 2, 30, 15, 4, 5);

  describe('buildTimestampSegment', () => {
    it('builds a compact YYYYMMDDHHMMSS timestamp', () => {
      expect(buildTimestampSegment(fixedDate)).toBe('20260330150405');
    });
  });

  describe('normalizeDeviceIdSegment', () => {
    it('normalizes mixed-case UUID-like ids to lowercase hyphen-safe segments', () => {
      expect(normalizeDeviceIdSegment('ABCD-1234-EF56')).toBe('abcd-1234-ef56');
    });

    it('collapses unsupported characters and trims separators', () => {
      expect(normalizeDeviceIdSegment('  device::ID / test  ')).toBe('device-id-test');
    });

    it('falls back when device id is empty', () => {
      expect(normalizeDeviceIdSegment('')).toBe('unknown-device');
    });
  });

  describe('buildAgentId', () => {
    it('builds the new chat id format', () => {
      expect(buildAgentId('Device:01', fixedDate, 'abc123xyz')).toBe(
        'chat_20260330150405_device-01_abc123xyz',
      );
    });
  });

  describe('buildChatSessionId', () => {
    it('builds the new chat session id format', () => {
      expect(buildChatSessionId('Device:01', fixedDate, 'abc123xyz')).toBe(
        'chatSession_20260330150405_device-01_abc123xyz',
      );
    });
  });

  describe('buildScheduleJobId', () => {
    it('builds the new schedule job id format', () => {
      expect(buildScheduleJobId('Device:01', fixedDate, 'abc123xyz')).toBe(
        'sched_20260330150405_device-01_abc123xyz',
      );
    });
  });

  describe('isValidChatSessionIdFormat', () => {
    it('accepts the chat session id format', () => {
      expect(isValidChatSessionIdFormat('chatSession_20260330150405_device-01_abc123xyz')).toBe(true);
    });

    it('rejects malformed chat session ids', () => {
      expect(isValidChatSessionIdFormat('chatSession_20260330150405')).toBe(false);
      expect(isValidChatSessionIdFormat('chatSession_20260330')).toBe(false);
      expect(isValidChatSessionIdFormat('chatSession_20260330150405_device-only')).toBe(false);
      expect(isValidChatSessionIdFormat('session_20260330150405_device-01_abc123xyz')).toBe(false);
    });
  });

  describe('extractMonthFromChatSessionIdValue', () => {
    it('extracts YYYYMM from the chat session id', () => {
      expect(extractMonthFromChatSessionIdValue('chatSession_20260330150405_device-01_abc123xyz')).toBe('202603');
    });

    it('returns null for invalid values', () => {
      expect(extractMonthFromChatSessionIdValue('chatSession_20251201010203')).toBeNull();
      expect(extractMonthFromChatSessionIdValue('invalid')).toBeNull();
    });
  });
});