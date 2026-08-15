import type { ChartRegionMapRenderer } from '../chart/region-map-contract.js';
import type { ChartThreeDRenderer } from '../chart/three-d-contract.js';
import type { MathRenderer } from '../math/mathjax.js';

/** Wire contract for optional render addons that must be re-created inside a
 * dedicated render worker. Functions never cross the structured-clone
 * boundary: the Window sends this plain descriptor and the worker imports the
 * implementation in its own realm. Built-ins use stable identities; custom
 * addons use an application-controlled ESM URL and named export. */
export const WORKER_ADDON_PROTOCOL = 'ooxml-worker-addon/v1' as const;

export type WorkerBuiltinAddonName = 'math' | 'threeD' | 'regionMap';

export interface WorkerBuiltinAddonDescriptor {
  readonly protocol: typeof WORKER_ADDON_PROTOCOL;
  /** Stable first-party addon identity resolved by a worker-local lazy import. */
  readonly builtin: WorkerBuiltinAddonName;
}

export interface WorkerModuleAddonDescriptor {
  readonly protocol: typeof WORKER_ADDON_PROTOCOL;
  /** Absolute ESM URL chosen by the application/library, never by OOXML input. */
  readonly moduleUrl: string;
  /** Named module export implementing the addon's ordinary direct contract. */
  readonly exportName: string;
}

export type WorkerAddonDescriptor =
  | WorkerBuiltinAddonDescriptor
  | WorkerModuleAddonDescriptor;

/** Optional capability implemented by an addon that can run in render workers. */
export interface WorkerLoadableAddon {
  readonly worker?: WorkerAddonDescriptor;
}

export interface WorkerRenderAddons {
  readonly math?: WorkerAddonDescriptor;
  readonly threeD?: WorkerAddonDescriptor;
  readonly regionMap?: WorkerAddonDescriptor;
}

export interface WorkerRenderAddonSources {
  readonly math?: WorkerLoadableAddon;
  readonly threeD?: WorkerLoadableAddon;
  readonly regionMap?: WorkerLoadableAddon;
}

export interface LoadedWorkerRenderAddons {
  readonly math?: MathRenderer;
  readonly threeD?: ChartThreeDRenderer;
  readonly regionMap?: ChartRegionMapRenderer;
}

function requireAbsoluteModuleUrl(moduleUrl: string): string {
  try {
    return new URL(moduleUrl).href;
  } catch {
    throw new TypeError(`Worker addon moduleUrl must be absolute: ${moduleUrl}`);
  }
}

export function createWorkerAddonDescriptor(
  moduleUrl: string,
  exportName: string,
): WorkerAddonDescriptor {
  if (!exportName) throw new TypeError('Worker addon exportName must not be empty');
  return Object.freeze({
    protocol: WORKER_ADDON_PROTOCOL,
    moduleUrl: requireAbsoluteModuleUrl(moduleUrl),
    exportName,
  });
}

/** Create a bundler-stable descriptor for a built-in optional renderer. */
export function createBuiltinWorkerAddonDescriptor(
  builtin: WorkerBuiltinAddonName,
): WorkerBuiltinAddonDescriptor {
  return Object.freeze({ protocol: WORKER_ADDON_PROTOCOL, builtin });
}

export function assertWorkerAddonDescriptor(
  descriptor: WorkerAddonDescriptor,
): WorkerAddonDescriptor {
  if (descriptor.protocol !== WORKER_ADDON_PROTOCOL) {
    throw new TypeError(`Unsupported worker addon protocol: ${String(descriptor.protocol)}`);
  }
  if ('builtin' in descriptor) {
    if (descriptor.builtin !== 'math'
      && descriptor.builtin !== 'threeD'
      && descriptor.builtin !== 'regionMap') {
      throw new TypeError(`Unsupported built-in worker addon: ${String(descriptor.builtin)}`);
    }
    return descriptor;
  }
  if (!descriptor.exportName) throw new TypeError('Worker addon exportName must not be empty');
  requireAbsoluteModuleUrl(descriptor.moduleUrl);
  return descriptor;
}

/** Strip direct function implementations before a load request crosses to a
 * render worker. Returns undefined when no supplied addon advertises worker
 * support, keeping the ordinary request payload minimal. */
export function workerRenderAddons(
  sources: WorkerRenderAddonSources,
): WorkerRenderAddons | undefined {
  const addons: WorkerRenderAddons = {
    ...(sources.math?.worker ? { math: assertWorkerAddonDescriptor(sources.math.worker) } : {}),
    ...(sources.threeD?.worker ? { threeD: assertWorkerAddonDescriptor(sources.threeD.worker) } : {}),
    ...(sources.regionMap?.worker
      ? { regionMap: assertWorkerAddonDescriptor(sources.regionMap.worker) }
      : {}),
  };
  return Object.keys(addons).length > 0 ? Object.freeze(addons) : undefined;
}

/** Import an addon's named export in the calling realm (normally a render
 * worker). The descriptor comes only from an explicit load option; document
 * content never selects executable module URLs. */
export async function loadWorkerAddon<T>(descriptor: WorkerAddonDescriptor): Promise<T> {
  assertWorkerAddonDescriptor(descriptor);
  if ('builtin' in descriptor) return loadBuiltinWorkerAddon(descriptor.builtin) as Promise<T>;
  const namespace = await import(/* @vite-ignore */ descriptor.moduleUrl) as Record<string, unknown>;
  if (!(descriptor.exportName in namespace)) {
    throw new TypeError(
      `Worker addon module ${descriptor.moduleUrl} does not export "${descriptor.exportName}"`,
    );
  }
  return namespace[descriptor.exportName] as T;
}

async function loadBuiltinWorkerAddon(builtin: WorkerBuiltinAddonName): Promise<object> {
  switch (builtin) {
    case 'math': {
      const engine = await import('../math/engine.js');
      return Object.freeze({
        loadMathJax: engine.loadMathJax,
        mathMLToSvg: engine.mathMLToSvg,
      });
    }
    case 'threeD': {
      const renderer = await import('../chart/three-d-renderer.js');
      return Object.freeze({ render: renderer.renderSimpleThreeDChart });
    }
    case 'regionMap': {
      const renderer = await import('../chart/region-map-renderer.js');
      return Object.freeze({ render: renderer.renderRegionMapChart });
    }
  }
}

function requireAddonMethods<T extends object>(
  addonName: string,
  value: unknown,
  methods: readonly string[],
): T {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`Worker ${addonName} addon export must be an object`);
  }
  const record = value as Record<string, unknown>;
  for (const method of methods) {
    if (typeof record[method] !== 'function') {
      throw new TypeError(`Worker ${addonName} addon must implement ${method}()`);
    }
  }
  return value as T;
}

/** Recreate all explicitly supplied render addons in the current worker realm. */
export async function loadWorkerRenderAddons(
  descriptors: WorkerRenderAddons | undefined,
): Promise<LoadedWorkerRenderAddons> {
  const [math, threeD, regionMap] = await Promise.all([
    descriptors?.math ? loadWorkerAddon(descriptors.math) : undefined,
    descriptors?.threeD ? loadWorkerAddon(descriptors.threeD) : undefined,
    descriptors?.regionMap ? loadWorkerAddon(descriptors.regionMap) : undefined,
  ]);
  return Object.freeze({
    ...(math ? {
      math: requireAddonMethods<MathRenderer>(
        'math',
        math,
        ['loadMathJax', 'mathMLToSvg'],
      ),
    } : {}),
    ...(threeD ? {
      threeD: requireAddonMethods<ChartThreeDRenderer>('threeD', threeD, ['render']),
    } : {}),
    ...(regionMap ? {
      regionMap: requireAddonMethods<ChartRegionMapRenderer>(
        'regionMap',
        regionMap,
        ['render'],
      ),
    } : {}),
  });
}
