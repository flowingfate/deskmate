// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './alert-dialog';
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from './dialog';

afterEach(cleanup);

describe('dialog initialFocusRef', () => {
  it('focuses the supplied Dialog target and restores focus to its trigger when closed', async () => {
    const targetRef = React.createRef<HTMLButtonElement>();

    render(
      <Dialog>
        <DialogTrigger>Open dialog</DialogTrigger>
        <DialogContent initialFocusRef={targetRef}>
          <DialogTitle>Dialog title</DialogTitle>
          <DialogClose>Cancel</DialogClose>
          <button ref={targetRef} type="button">
            Continue
          </button>
        </DialogContent>
      </Dialog>,
    );

    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    fireEvent.click(trigger);

    await waitFor(() => expect(document.activeElement).toBe(targetRef.current));

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('marks a programmatic initial target for a visible focus indicator until it blurs', async () => {
    const targetRef = React.createRef<HTMLButtonElement>();

    render(
      <Dialog>
        <DialogTrigger>Open dialog</DialogTrigger>
        <DialogContent initialFocusRef={targetRef}>
          <DialogTitle>Dialog title</DialogTitle>
          <button ref={targetRef} type="button">
            Delete
          </button>
        </DialogContent>
      </Dialog>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    await waitFor(() => expect(document.activeElement).toBe(targetRef.current));

    const target = targetRef.current;
    if (!target) {
      throw new Error('Initial focus target was not rendered');
    }

    expect(target).toHaveAttribute('data-initial-focus');
    // 原生 blur()：焦点真正移出（activeElement → body），属性在下一帧被移除。
    target.blur();
    await waitFor(() => expect(target).not.toHaveAttribute('data-initial-focus'));
  });

  it('overrides AlertDialog default Cancel focus with the supplied action target', async () => {
    const actionRef = React.createRef<HTMLButtonElement>();

    render(
      <AlertDialog>
        <AlertDialogTrigger>Delete item</AlertDialogTrigger>
        <AlertDialogContent initialFocusRef={actionRef}>
          <AlertDialogTitle>Delete this item?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction ref={actionRef}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete item' }));

    await waitFor(() => expect(document.activeElement).toBe(actionRef.current));
    expect(actionRef.current).toHaveAttribute('data-initial-focus');
  });

  it('preserves an existing onOpenAutoFocus cancellation', async () => {
    const targetRef = React.createRef<HTMLButtonElement>();
    const onOpenAutoFocus = vi.fn((event: Event) => event.preventDefault());

    render(
      <Dialog>
        <DialogTrigger>Open dialog</DialogTrigger>
        <DialogContent initialFocusRef={targetRef} onOpenAutoFocus={onOpenAutoFocus}>
          <DialogTitle>Dialog title</DialogTitle>
          <button ref={targetRef} type="button">
            Continue
          </button>
        </DialogContent>
      </Dialog>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));

    await waitFor(() => expect(onOpenAutoFocus).toHaveBeenCalledTimes(1));
    expect(document.activeElement).not.toBe(targetRef.current);
  });

  it('leaves Radix fallback focus intact when the target is disabled or unavailable', async () => {
    const disabledActionRef = React.createRef<HTMLButtonElement>();
    const missingRef = React.createRef<HTMLButtonElement>();

    const firstDialog = render(
      <AlertDialog>
        <AlertDialogTrigger>Delete item</AlertDialogTrigger>
        <AlertDialogContent initialFocusRef={disabledActionRef}>
          <AlertDialogTitle>Delete this item?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction ref={disabledActionRef} disabled>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete item' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })));

    firstDialog.unmount();
    render(
      <Dialog open>
        <DialogContent initialFocusRef={missingRef}>
          <DialogTitle>Dialog title</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus());
  });

  it('leaves Radix fallback focus intact when the supplied target cannot receive focus', async () => {
    const nonFocusableRef = React.createRef<HTMLDivElement>();

    render(
      <Dialog open>
        <DialogContent initialFocusRef={nonFocusableRef}>
          <DialogTitle>Dialog title</DialogTitle>
          <div ref={nonFocusableRef}>Not focusable</div>
        </DialogContent>
      </Dialog>,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus());

    const target = nonFocusableRef.current;
    if (!target) {
      throw new Error('Non-focusable target was not rendered');
    }

    expect(target).not.toHaveAttribute('data-initial-focus');
  });

  it('keeps the focus indicator through a transient blur that immediately refocuses the target', async () => {
    const targetRef = React.createRef<HTMLButtonElement>();

    render(
      <Dialog>
        <DialogTrigger>Open dialog</DialogTrigger>
        <DialogContent initialFocusRef={targetRef}>
          <DialogTitle>Dialog title</DialogTitle>
          <button ref={targetRef} type="button">
            Delete
          </button>
        </DialogContent>
      </Dialog>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    await waitFor(() => expect(document.activeElement).toBe(targetRef.current));

    const target = targetRef.current;
    if (!target) {
      throw new Error('Initial focus target was not rendered');
    }

    // 复现 DropdownMenu 关闭抢焦点：blur 触发，但焦点立刻被 focus-scope 拉回本元素。
    expect(target).toHaveAttribute('data-initial-focus');
    fireEvent.blur(target);
    expect(document.activeElement).toBe(target);

    // 等待 blur 的下一帧判断跑完，属性应保留（焦点从未真正离开）。
    const frame = Promise.withResolvers<void>();
    requestAnimationFrame(() => frame.resolve());
    await frame.promise;
    expect(target).toHaveAttribute('data-initial-focus');
  });
});
