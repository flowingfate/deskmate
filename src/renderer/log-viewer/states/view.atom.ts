// Log Viewer 顶层状态：
//   - currentViewAtom：当前激活的 view（SideNav 切换）
//   - dbPathAtom：sqlite db 路径，首次被消费时异步拉取一次
//   - traceFocusAtom：一次性 trace 跳转。openTrace 同时切 view + 设置 focus；
//     TracesView 消费后调 consume 清掉，避免再次切回时被旧值自动复读。

import { atom } from '@/atom';
import { ViewId } from '../views';
import { viewerApi } from '../api';

export const currentViewAtom = atom<ViewId>('logs');

export const dbPathAtom = atom(null as string | null, (_get, set) => {
  viewerApi.getDbPath().then(set).catch(() => set(null));
  return {};
});

export const traceFocusAtom = atom(null as string | null, (_get, set, use) => ({
  openTrace(id: string) {
    const [, setCurrent] = use(currentViewAtom);
    set(id);
    setCurrent('traces');
  },
  consume() {
    set(null);
  },
}));
