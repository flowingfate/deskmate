import { log } from '@main/log';
import { UpdateManager } from './updateManager';

export { UpdateManager };

let singleton: UpdateManager | null = null;

export function setup() {
  if (singleton) return singleton;

  try {
    singleton = new UpdateManager();
    singleton.startPeriodicCheck(360); // Check every 6 hours
    console.log('[Startup] UpdateManager periodic check started', { intervalMinutes: 360 });
    log.info({ msg: '[Startup] UpdateManager periodic check started', mod: 'main', intervalMinutes: 360 });
    return singleton;
  } catch (e) {
    console.error('[Startup] UpdateManager initialization failed:', e);
    throw e;
  }
}

export function stop() {
  if (singleton) {
    singleton.destroy();
    singleton = null;
    console.log('UpdateManager destroyed');
  }
}

export const updater = {
  setup,
  stop,
};
