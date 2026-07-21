import { describe, expect, it } from 'vitest';
import { DiagnosticLogRing } from '../DiagnosticLogRing';

describe('DiagnosticLogRing bindings', () => {
  it('preserves child bindings while allowing a log call to override them', () => {
    const ring = new DiagnosticLogRing();
    ring.bindLife(7);

    ring.append('info', {
      msg: 'overrides child context',
      mod: 'call.component',
      profileId: 'p_call',
    }, {
      mod: 'child.component',
      profileId: 'p_child',
      agentId: 'a_child',
      sessionId: 's_child',
      route: '/child-route',
    });
    ring.append('info', { msg: 'inherits child context' }, {
      mod: 'child.component',
      profileId: 'p_child',
      agentId: 'a_child',
      sessionId: 's_child',
      route: '/child-route',
    });

    const { entries } = ring.snapshot(0, Date.now());
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      component: 'call.component',
      lifeId: 7,
      context: {
        profileId: 'p_call',
        agentId: 'a_child',
        sessionId: 's_child',
        route: '/child-route',
      },
    });
    expect(entries[1]).toMatchObject({
      component: 'child.component',
      context: {
        profileId: 'p_child',
        agentId: 'a_child',
        sessionId: 's_child',
        route: '/child-route',
      },
    });
  });
});
