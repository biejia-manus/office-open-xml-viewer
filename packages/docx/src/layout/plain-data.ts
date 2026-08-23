import type { DeepReadonly } from './types.js';
import { documentLayoutValidationEnabled } from './validation-policy.js';

function assertPlainData(
  value: unknown,
  path: string,
  visiting = new WeakSet<object>(),
  completed = new WeakSet<object>(),
): void {
  if (
    value === null
    || value === undefined
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must contain finite numbers`);
    return;
  }
  if (typeof value !== 'object') {
    throw new TypeError(`${path} must be structured-clone-safe plain data`);
  }
  if (visiting.has(value)) {
    throw new TypeError(`${path} must be structured-clone-safe plain data`);
  }
  if (completed.has(value)) return;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must be structured-clone-safe plain data`);
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError(`${path} must contain only enumerable string data properties`);
  }
  visiting.add(value);
  try {
    for (const key of Object.getOwnPropertyNames(value)) {
      if (Array.isArray(value) && key === 'length') continue;
      // Plain-data arrays carry index properties only. Enforced here (rather
      // than merely assumed) because `deepFreezePlainData` walks arrays by
      // index: an array with an extra own property would otherwise have that
      // property's subgraph left unfrozen.
      if (Array.isArray(value) && String(Number(key)) !== key) {
        throw new TypeError(`${path}.${key} must be an array index`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        throw new TypeError(`${path}.${key} must be an enumerable data property`);
      }
      assertPlainData(descriptor.value, `${path}.${key}`, visiting, completed);
    }
  } finally {
    visiting.delete(value);
  }
  completed.add(value);
}

export function deepFreezePlainData<T>(
  value: T,
  seen = new WeakSet<object>(),
): DeepReadonly<T> {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return value as DeepReadonly<T>;
  }
  seen.add(value);
  // Walked without `Object.values`, which allocates a fresh array for every
  // node: retained geometry is a deep graph of small objects, so that
  // array-per-node is pure garbage on a hot path. The visited set is unchanged —
  // plain data has only own enumerable string-keyed properties, and arrays carry
  // index properties only (enforced by `assertPlainData` above).
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      deepFreezePlainData(value[index], seen);
    }
  } else {
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        deepFreezePlainData((value as Record<string, unknown>)[key], seen);
      }
    }
  }
  return Object.freeze(value) as DeepReadonly<T>;
}

export function snapshotPlainData<T>(value: T, label: string): DeepReadonly<T> {
  // Contract check on engine-produced data — see validation-policy.ts. The
  // structured clone below still rejects genuinely non-cloneable graphs, so a
  // real violation is reported either way; only the precise property path is
  // development-only.
  if (documentLayoutValidationEnabled()) assertPlainData(value, label);
  try {
    return deepFreezePlainData(structuredClone(value));
  } catch {
    throw new TypeError(`${label} must be structured-clone-safe plain data`);
  }
}

/** Validate and recursively seal builder-owned plain data in place. Unlike
 * snapshotPlainData this has no second structured-clone peak; callers must own
 * the supplied graph and must not expose it for later mutation. */
export function sealPlainData<T>(value: T, label: string): DeepReadonly<T> {
  if (documentLayoutValidationEnabled()) assertPlainData(value, label);
  return deepFreezePlainData(value);
}
