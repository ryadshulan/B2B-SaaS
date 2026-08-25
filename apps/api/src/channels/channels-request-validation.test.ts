import { describe, expect, it } from 'vitest';
import { parseChannelId } from './channels-request-validation';

describe('channel route validation', () => {
  it('accepts canonical UUIDs and rejects malformed route IDs safely', () => {
    const id = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
    expect(parseChannelId(id)).toBe(id);
    for (const value of [undefined, null, 12, 'not-a-uuid', id.toUpperCase()]) {
      expect(() => parseChannelId(value)).toThrowError('validation_error');
    }
  });
});
