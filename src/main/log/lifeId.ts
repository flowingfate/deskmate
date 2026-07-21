const MAX_LIFE_ID = 200_000;

let configuredLifeId: number | null = null;

export function assertLogLifeId(lifeId: number): void {
  if (!Number.isInteger(lifeId) || lifeId < 0 || lifeId > MAX_LIFE_ID) {
    throw new Error(`Log lifeId must be in [0, ${MAX_LIFE_ID}].`);
  }
}

export function configureLogLifeId(lifeId: number): void {
  assertLogLifeId(lifeId);
  if (configuredLifeId !== null && configuredLifeId !== lifeId) {
    throw new Error('Log lifeId is immutable after bootstrap.');
  }
  configuredLifeId = lifeId;
}

export function requireLogLifeId(): number {
  if (configuredLifeId === null) {
    throw new Error('Log lifeId must be configured by bootstrap before logger initialization.');
  }
  return configuredLifeId;
}
