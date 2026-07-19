import { describe, expect, it } from 'vitest';
import { Profile } from '../../../profile';
import { ProfileStore } from '../../../persist';

const store = await ProfileStore.load(`p_tool_context_${process.pid}`);

export const testProfile = new Profile(store);


describe('tool Profile fixture', () => {
  it('provides one explicit runtime Profile', () => {
    expect(testProfile.store).toBe(store);
  });
});
