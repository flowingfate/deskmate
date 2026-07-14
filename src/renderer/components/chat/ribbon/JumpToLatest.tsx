import type { ReactElement } from 'react';
import { atom } from '@/atom';

import { RibbonItem } from './RibbonItem';
interface JumpToLatestState {
  isAvailable: boolean;
  requestNonce: number;
}

const initialJumpToLatestState: JumpToLatestState = {
  isAvailable: false,
  requestNonce: 0,
};

export const JumpToLatestAtom = atom(initialJumpToLatestState, (get, set) => {
  function setAvailable(isAvailable: boolean) {
    const current = get();
    if (current.isAvailable === isAvailable) return;

    set({ ...current, isAvailable });
  }

  function requestJump() {
    const current = get();
    if (!current.isAvailable) return;

    set({
      isAvailable: false,
      requestNonce: current.requestNonce + 1,
    });
  }

  return { setAvailable, requestJump };
});


export function JumpToLatestItem(): ReactElement {
  const [{ isAvailable }, actions] = JumpToLatestAtom.use();
  return (
    <RibbonItem
      disabled={!isAvailable}
      onClick={actions.requestJump}
      aria-label={isAvailable ? 'Jump to latest' : 'Already at latest message'}
      tooltip={isAvailable ? 'Jump to latest' : 'Already at latest message'}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M3.5 4L8 8.5L12.5 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M3.5 8.5L8 13L12.5 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {isAvailable && <span className="whitespace-nowrap">Jump to latest</span>}
    </RibbonItem>
  );
}
