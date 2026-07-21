import { describe, expect, it } from 'vitest';
import { configureLogLifeId, requireLogLifeId } from '../lifeId';

describe('log lifeId configuration', () => {
  it('requires bootstrap to configure a valid lifeId once', () => {
    expect(() => requireLogLifeId()).toThrow('configured by bootstrap');
    expect(() => configureLogLifeId(-1)).toThrow('lifeId');

    configureLogLifeId(0);
    expect(requireLogLifeId()).toBe(0);
    expect(() => configureLogLifeId(1)).toThrow('immutable');
  });
});
