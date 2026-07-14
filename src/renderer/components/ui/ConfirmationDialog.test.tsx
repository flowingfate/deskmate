// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ConfirmationDialogHost, requestConfirmation } from './ConfirmationDialog';

afterEach(cleanup);

describe('ConfirmationDialogHost', () => {
  it('resolves the focused confirm action and supersedes an earlier request with false', async () => {
    render(<ConfirmationDialogHost />);

    let firstRequest: Promise<boolean>;
    act(() => {
      firstRequest = requestConfirmation({
        title: 'First confirmation',
        description: 'First request',
        confirmLabel: 'Confirm first',
      });
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm first' })).toHaveFocus());

    let secondRequest: Promise<boolean>;
    act(() => {
      secondRequest = requestConfirmation({
        title: 'Second confirmation',
        description: 'Second request',
        confirmLabel: 'Confirm second',
      });
    });

    await expect(firstRequest!).resolves.toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm second' }));
    await expect(secondRequest!).resolves.toBe(true);
  });

  it('resolves false when cancelled', async () => {
    render(<ConfirmationDialogHost />);

    let request: Promise<boolean>;
    act(() => {
      request = requestConfirmation({
        title: 'Discard changes?',
        description: 'Discard the pending edits.',
        confirmLabel: 'Discard changes',
        destructive: true,
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await expect(request!).resolves.toBe(false);
  });
});
