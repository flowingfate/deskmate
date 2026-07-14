// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./ApplySubAgentToAgentsDialog', () => ({
  default: () => <div data-testid="apply-sub-agent-dialog-host" />,
}));

import SubAgentsSettingsLayout from './SubAgentsSettingsLayout';

function CreateSubAgentRoute(): React.ReactElement {
  return <div>Create sub-agent route</div>;
}

describe('SubAgentsSettingsLayout', () => {
  it('keeps the apply-dialog host mounted for the create route', () => {
    render(
      <MemoryRouter initialEntries={['/settings/sub-agents/new']}>
        <Routes>
          <Route path="/settings/sub-agents" element={<SubAgentsSettingsLayout />}>
            <Route path="new" element={<CreateSubAgentRoute />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Create sub-agent route')).toBeVisible();
    expect(screen.getByTestId('apply-sub-agent-dialog-host')).toBeVisible();
  });
});
