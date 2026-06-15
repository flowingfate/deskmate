

export function partialAssign<T extends object>(src: T, delta: Partial<T> | T) {
  let dirty = false;
  Object.keys(delta).forEach((key) => {
    const value = delta[key as keyof T];
    if (value === undefined) return;
    src[key as keyof T] = value as T[keyof T];
    dirty = true;
  });
  return dirty;
}

