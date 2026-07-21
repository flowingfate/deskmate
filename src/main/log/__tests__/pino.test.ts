import { describe, expect, it } from 'vitest';
import { createPinoLogger } from '../pino';

describe('createPinoLogger', () => {
  it('accepts the explicit degraded lifeId in test mode', () => {
    const result = createPinoLogger({ lifeId: 0 });

    expect(result.transport).toBeNull();
  });

  it('rejects a lifeId outside the supported range', () => {
    expect(() => createPinoLogger({ lifeId: -1 })).toThrow('lifeId');
    expect(() => createPinoLogger({ lifeId: 200_001 })).toThrow('lifeId');
  });
});
