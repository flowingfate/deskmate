type AppNavigateHandler = (path: string, replace: boolean) => Promise<void>;


let navigateHandler: AppNavigateHandler = () => Promise.resolve();

export function registerAppNavigateHandler(handler: AppNavigateHandler): void {
  navigateHandler = handler;
}

export function navigateInApp(path: string, replace = false): void {
  navigateHandler(path, replace);
}
