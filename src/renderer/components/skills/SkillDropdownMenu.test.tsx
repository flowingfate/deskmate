// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const skillMocks = vi.hoisted(() => ({
  isDev: vi.fn(),
  requestDelete: vi.fn(),
  openSkillFolder: vi.fn(),
  showError: vi.fn(),
}));

vi.mock('@/ipc/app', () => ({
  appApi: { isDev: skillMocks.isDev },
}));

vi.mock('@/ipc/skill', () => ({
  skillsApi: { openSkillFolder: skillMocks.openSkillFolder },
}));

vi.mock('../ui/ToastProvider', () => ({
  useToast: () => ({ showError: skillMocks.showError }),
}));

vi.mock('./skillCommands.atom', () => ({
  DeleteSkillDialogAtom: {
    useChange: () => ({ requestDelete: skillMocks.requestDelete }),
  },
}));

import SkillDropdownMenu from './SkillDropdownMenu';

afterEach(() => {
  vi.clearAllMocks();
});

describe('SkillDropdownMenu', () => {
  it('opens from the real More button, retains the development-only folder action, and deletes the current skill', async () => {
    skillMocks.isDev.mockResolvedValue(true);
    render(<SkillDropdownMenu skillName="research" />);

    const trigger = screen.getByRole('button', { name: 'Actions for research' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });

    await waitFor(() => expect(screen.getByRole('menuitem', { name: /Open in/ })).toBeVisible());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    expect(skillMocks.requestDelete).toHaveBeenCalledWith('research');
  });
});
