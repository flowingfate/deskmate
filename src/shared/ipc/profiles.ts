import { connectRenderToMain } from './base';

export type ProfileWindowState = 'current' | 'open' | 'closed';
export type ProfileRemovalBlockReason = 'current' | 'open' | 'last';

export type ProfileRemovalEligibility =
  | { kind: 'allowed' }
  | { kind: 'blocked'; reason: ProfileRemovalBlockReason };

export type ProfileRemovalResult =
  | { kind: 'deleted' }
  | { kind: 'blocked'; reason: ProfileRemovalBlockReason };

/** Renderer 可安全读取的 Profile 索引投影。 */
export interface ProfileListItem {
  id: string;
  displayName: string;
  avatar?: string;
  kind: 'guest' | 'signed_in';
  windowState: ProfileWindowState;
}

export interface ProfileManagementItem extends ProfileListItem {
  createdAt: string;
  removal: ProfileRemovalEligibility;
}

type RenderToMain = {
  list: {
    call: [];
    return: ProfileListItem[];
  };
  listManaged: {
    call: [];
    return: ProfileManagementItem[];
  };
  createAndOpen: {
    call: [input: { displayName: string }];
    return: ProfileListItem;
  };
  updateMetadata: {
    call: [input: { profileId: string; displayName: string }];
    return: ProfileManagementItem;
  };
  delete: {
    call: [input: { profileId: string; confirmationName: string }];
    return: ProfileRemovalResult;
  };
};

export const renderToMain = connectRenderToMain<RenderToMain>('profiles');
