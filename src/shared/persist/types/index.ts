/**
 * 本地持久化 schema 的唯一公共入口。
 *
 * 每个子模块只描述一个磁盘资源域，且不依赖 `src/shared/types/`；main、renderer
 * 与 worker 只能从这里导入持久化数据形态，避免持久化层反向依赖运行时类型。
 */
export * from './agent';
export * from './auth';
export * from './message';
export * from './profile';
export * from './resource';
export * from './schedule';
export * from './session';
export * from './settings';
export * from './subAgent';
export * from './subrun';
export * from './thinking';
