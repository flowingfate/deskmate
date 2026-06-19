import * as React from 'react';
import { ThemeState, type GlobalProvider } from '@ladle/react';
import './ladle.css';

/**
 * Ladle 全局 Provider：
 * 1. 注入全局样式（Tailwind + shadcn 令牌）。
 * 2. 将 Ladle 的主题状态同步到 <html>.dark，驱动 shadcn 暗色令牌。
 * 3. 为所有 story 提供统一的内边距画布。
 */
export const Provider: GlobalProvider = ({ children, globalState }) => {
  React.useEffect(() => {
    const root = document.documentElement;
    const prefersDark =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark =
      globalState.theme === ThemeState.Dark ||
      (globalState.theme === ThemeState.Auto && prefersDark);
    root.classList.toggle('dark', isDark);
  }, [globalState.theme]);

  return (
    <div className="min-h-screen bg-sc-background p-8 text-sc-foreground">
      {children}
    </div>
  );
};
