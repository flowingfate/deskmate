// 外部消费者只能从此文件导入 scheduler 能力；实现文件保持模块内部细节。
export { SchedulerManager, schedulerManager } from './manager';
export { registerSchedulerIPC } from './ipc';
export { toSchedulerJob } from './jobAdapter';
