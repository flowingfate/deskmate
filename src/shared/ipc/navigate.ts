import { connectMainToRender } from './base';

export interface NavigatePayload {
  route: string;
  state?: unknown;
}

type MainToRender = {
  to: NavigatePayload;
};

export const mainToRender = connectMainToRender<MainToRender>('navigate');
