import { useSyncExternalStore } from "react";

export type Listen<T> = (cb: (data: T) => void) => VoidFunction;
export type Reduce<T> = (data: T) => T;
export type Change<T> = (ch: Reduce<T> | T) => void;

export function unit<T>(
  val: T,
  equal: ((prev: T, next: T) => boolean) = Object.is,
) {
  const listener = new Set<(val: T) => void>();
  const change: Change<T> = (ch) => {
    const next = (typeof ch === 'function') ? (ch as Reduce<T>)(val) : ch;
    if (equal(val, next)) return;
    val = next;
    listener.forEach(call => call(next));
  };
  const listen: Listen<T> = (call) => {
    listener.add(call);
    return () => listener.delete(call);
  };
  const get = () => val;
  const set = change;
  const use = () => useSyncExternalStore(listen, get, get);
  return { get, set, change, listen, use };
}
