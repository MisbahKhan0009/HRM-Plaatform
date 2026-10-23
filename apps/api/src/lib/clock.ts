/** Injected time source (CODING-STANDARDS §6): services never call `new Date()` directly. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export const fixedClock = (at: Date): Clock => ({ now: () => new Date(at.getTime()) });
