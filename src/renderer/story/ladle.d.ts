/**
 * Ladle 5.1.1 的声明会继续解析其内置 TSX 源码；该源码尚未兼容 TypeScript 7。
 * Stories 仅使用其 `Story` 类型，因此在 renderer 类型检查中声明最小公开契约。
 */
declare module '@ladle/react' {
  import type { ReactNode } from 'react';

  export interface Story {
    (): ReactNode;
  }
}
