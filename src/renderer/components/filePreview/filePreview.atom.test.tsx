// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { WithStore } from '@/atom';
import { ConfirmationDialogHost } from '../ui/ConfirmationDialog';
import { type FilePreviewDescriptor } from './FilePreviewPanel';
import { ChatFilePreviewAtom } from './filePreview.atom';

afterEach(cleanup);

const FIRST_FILE: FilePreviewDescriptor = { name: 'first.txt', url: '/tmp/first.txt', mimeType: 'text/plain' };
const SECOND_FILE: FilePreviewDescriptor = { name: 'second.txt', url: '/tmp/second.txt', mimeType: 'text/plain' };

let preview: FilePreviewDescriptor | null = null;
let openPreview: (file: FilePreviewDescriptor) => Promise<void>;
let markPreviewDirty: (isDirty: boolean) => void;

function Harness() {
  const [state, actions] = ChatFilePreviewAtom.use();
  preview = state?.file ?? null;
  openPreview = actions.open;
  markPreviewDirty = actions.markDirty;
  return null;
}

describe('file preview discard confirmation', () => {
  it('keeps the dirty preview for Cancel and switches only after Discard changes', async () => {
    render(
      <>
        <ConfirmationDialogHost />
        <WithStore>
          <Harness />
        </WithStore>
      </>,
    );

    await act(async () => {
      await openPreview(FIRST_FILE);
    });
    act(() => markPreviewDirty(true));

    let cancelledSwitch: Promise<void>;
    act(() => {
      cancelledSwitch = openPreview(SECOND_FILE);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await act(async () => {
      await cancelledSwitch!;
    });
    expect(preview).toEqual(FIRST_FILE);

    let confirmedSwitch: Promise<void>;
    act(() => {
      confirmedSwitch = openPreview(SECOND_FILE);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await act(async () => {
      await confirmedSwitch!;
    });
    await waitFor(() => expect(preview).toEqual(SECOND_FILE));
  });
});
