import type { DeepReadonly } from './types.js';

/** Object graphs already validated and deeply frozen by snapshotPlainData or
 * sealPlainData. Registered graphs are engine-owned and immutable, so layout
 * boundaries that receive them again (whole or as subtrees of a fresh
 * wrapper) can reuse them by reference instead of re-validating, re-cloning,
 * and re-freezing the same multi-megabyte structures on every call. */
const processedPlainData = new WeakSet<object>();

/** Object graphs already deeply frozen by deepFreezePlainData. Freeze walks
 * use this only to skip re-walking; it never relaxes validation, because
 * deepFreezePlainData alone does not prove a graph is plain data. */
const frozenPlainData = new WeakSet<object>();

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
  if (completed.has(value) || processedPlainData.has(value)) return;
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
  if (processedPlainData.has(value) || frozenPlainData.has(value)) {
    return value as DeepReadonly<T>;
  }
  seen.add(value);
  for (const child of Object.values(value)) deepFreezePlainData(child, seen);
  Object.freeze(value);
  frozenPlainData.add(value);
  return value as DeepReadonly<T>;
}

/** Validate and clone a plain-data graph in a single walk. Already-processed
 * subtrees are reused by reference (they are immutable, so sharing is safe);
 * every newly cloned node is frozen and registered. Throws the same TypeErrors
 * as assertPlainData for non-plain or cyclic data; the input is never
 * mutated. */
function snapshotNode(
  value: unknown,
  path: string,
  clones: Map<object, object>,
  visiting: WeakSet<object>,
): unknown {
  if (
    value === null
    || value === undefined
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must contain finite numbers`);
    return value;
  }
  if (typeof value !== 'object') {
    throw new TypeError(`${path} must be structured-clone-safe plain data`);
  }
  if (processedPlainData.has(value)) return value;
  const existing = clones.get(value);
  if (existing !== undefined) {
    if (visiting.has(value)) {
      throw new TypeError(`${path} must be structured-clone-safe plain data`);
    }
    return existing;
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must be structured-clone-safe plain data`);
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError(`${path} must contain only enumerable string data properties`);
  }
  const copy: object = Array.isArray(value) ? [] : {};
  const view = copy as Record<string, unknown>;
  clones.set(value, copy);
  visiting.add(value);
  try {
    for (const key of Object.getOwnPropertyNames(value)) {
      if (Array.isArray(value) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        throw new TypeError(`${path}.${key} must be an enumerable data property`);
      }
      const child = snapshotNode(descriptor.value, `${path}.${key}`, clones, visiting);
      if (key === '__proto__') {
        // Assignment would mutate the prototype instead of creating an own
        // data property the way structuredClone does.
        Object.defineProperty(copy, key, {
          value: child,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      } else {
        view[key] = child;
      }
    }
  } finally {
    visiting.delete(value);
  }
  Object.freeze(copy);
  processedPlainData.add(copy);
  return copy;
}

export function snapshotPlainData<T>(value: T, label: string): DeepReadonly<T> {
  if (typeof value === 'object' && value !== null && processedPlainData.has(value)) {
    return value as DeepReadonly<T>;
  }
  return snapshotNode(value, label, new Map(), new WeakSet()) as DeepReadonly<T>;
}

/** Validate and recursively seal builder-owned plain data in place. Unlike
 * snapshotPlainData this has no second structured-clone peak; callers must own
 * the supplied graph and must not expose it for later mutation. */
export function sealPlainData<T>(value: T, label: string): DeepReadonly<T> {
  assertPlainData(value, label);
  return deepFreezeAndRegister(value, new WeakSet()) as DeepReadonly<T>;
}

function deepFreezeAndRegister(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  if (processedPlainData.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreezeAndRegister(child, seen);
  Object.freeze(value);
  processedPlainData.add(value);
  return value;
}
