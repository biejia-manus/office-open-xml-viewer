/** Structured-clone-safe contract for an optional renderer that must be
 * reconstructed inside a dedicated render worker. Functions never cross the
 * worker boundary: the main realm sends this descriptor and the worker imports
 * the implementation in its own realm. */
export const WORKER_RENDERER_MODULE_PROTOCOL = 'ooxml-worker-renderer-module/v1' as const;

export type WorkerBuiltinRendererName = 'math' | 'threeD' | 'regionMap';

export interface WorkerBuiltinRendererDescriptor {
  readonly protocol: typeof WORKER_RENDERER_MODULE_PROTOCOL;
  /** Stable first-party renderer identity resolved by a worker-local lazy import. */
  readonly builtin: WorkerBuiltinRendererName;
}

export interface WorkerRendererModuleDescriptor {
  readonly protocol: typeof WORKER_RENDERER_MODULE_PROTOCOL;
  /** Absolute ESM URL chosen by the application/library, never by OOXML input. */
  readonly moduleUrl: string;
  /** Named module export implementing the renderer's ordinary direct contract. */
  readonly exportName: string;
}

export type WorkerRendererDescriptor =
  | WorkerBuiltinRendererDescriptor
  | WorkerRendererModuleDescriptor;

/** Optional capability implemented by a renderer that can run in render workers. */
export interface WorkerLoadableRenderer {
  readonly worker?: WorkerRendererDescriptor;
}

export interface WorkerRendererDescriptors {
  readonly math?: WorkerRendererDescriptor;
  readonly threeD?: WorkerRendererDescriptor;
  readonly regionMap?: WorkerRendererDescriptor;
}

export interface WorkerRendererSources {
  readonly math?: WorkerLoadableRenderer;
  readonly threeD?: WorkerLoadableRenderer;
  readonly regionMap?: WorkerLoadableRenderer;
}

function requireAbsoluteModuleUrl(moduleUrl: string): string {
  try {
    return new URL(moduleUrl).href;
  } catch {
    throw new TypeError(`Worker renderer moduleUrl must be absolute: ${moduleUrl}`);
  }
}

/** Describe a custom renderer module that a render worker can import on demand. */
export function createWorkerRendererModuleDescriptor(
  moduleUrl: string,
  exportName: string,
): WorkerRendererModuleDescriptor {
  if (!exportName) throw new TypeError('Worker renderer exportName must not be empty');
  return Object.freeze({
    protocol: WORKER_RENDERER_MODULE_PROTOCOL,
    moduleUrl: requireAbsoluteModuleUrl(moduleUrl),
    exportName,
  });
}

/** Create a bundler-stable descriptor for a built-in optional renderer. */
export function createBuiltinWorkerRendererDescriptor(
  builtin: WorkerBuiltinRendererName,
): WorkerBuiltinRendererDescriptor {
  return Object.freeze({ protocol: WORKER_RENDERER_MODULE_PROTOCOL, builtin });
}

export function assertWorkerRendererDescriptor(
  descriptor: WorkerRendererDescriptor,
): WorkerRendererDescriptor {
  if (descriptor.protocol !== WORKER_RENDERER_MODULE_PROTOCOL) {
    throw new TypeError(`Unsupported worker renderer protocol: ${String(descriptor.protocol)}`);
  }
  if ('builtin' in descriptor) {
    if (descriptor.builtin !== 'math'
      && descriptor.builtin !== 'threeD'
      && descriptor.builtin !== 'regionMap') {
      throw new TypeError(`Unsupported built-in worker renderer: ${String(descriptor.builtin)}`);
    }
    return descriptor;
  }
  if (!descriptor.exportName) throw new TypeError('Worker renderer exportName must not be empty');
  requireAbsoluteModuleUrl(descriptor.moduleUrl);
  return descriptor;
}

/** Strip direct function implementations before a load request crosses to a
 * render worker. Returns undefined when no supplied renderer advertises worker
 * support, keeping the ordinary request payload minimal. */
export function workerRendererDescriptors(
  sources: WorkerRendererSources,
): WorkerRendererDescriptors | undefined {
  const descriptors: WorkerRendererDescriptors = {
    ...(sources.math?.worker ? { math: assertWorkerRendererDescriptor(sources.math.worker) } : {}),
    ...(sources.threeD?.worker ? { threeD: assertWorkerRendererDescriptor(sources.threeD.worker) } : {}),
    ...(sources.regionMap?.worker
      ? { regionMap: assertWorkerRendererDescriptor(sources.regionMap.worker) }
      : {}),
  };
  return Object.keys(descriptors).length > 0 ? Object.freeze(descriptors) : undefined;
}
