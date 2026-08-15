import { describe, expect, it } from 'vitest';
import {
  createBuiltinWorkerRendererDescriptor,
  createWorkerRendererModuleDescriptor,
  workerRendererDescriptors,
  WORKER_RENDERER_MODULE_PROTOCOL,
} from './renderer-module-contract.js';
import {
  loadWorkerRenderer,
  loadWorkerRenderers,
} from './renderer-module.js';

describe('worker renderer module descriptors', () => {
  it('remain plain structured-clone-safe data', () => {
    const descriptor = createWorkerRendererModuleDescriptor(
      'https://example.invalid/ooxml-renderer.mjs',
      'renderer',
    );

    expect(structuredClone(descriptor)).toEqual({
      protocol: WORKER_RENDERER_MODULE_PROTOCOL,
      moduleUrl: 'https://example.invalid/ooxml-renderer.mjs',
      exportName: 'renderer',
    });
  });

  it('loads built-ins by a bundler-stable identity instead of an export name', async () => {
    const descriptor = createBuiltinWorkerRendererDescriptor('threeD');

    expect(structuredClone(descriptor)).toEqual({
      protocol: WORKER_RENDERER_MODULE_PROTOCOL,
      builtin: 'threeD',
    });
    const renderer = await loadWorkerRenderer<{ render: unknown }>(descriptor);
    expect(typeof renderer.render).toBe('function');
  });

  it('loads the named export inside the current realm', async () => {
    const source = 'export const renderer = Object.freeze({ kind: "worker-test" });';
    const descriptor = createWorkerRendererModuleDescriptor(
      `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`,
      'renderer',
    );

    await expect(loadWorkerRenderer<{ kind: string }>(descriptor)).resolves.toEqual({
      kind: 'worker-test',
    });
  });

  it('rejects incompatible protocols before importing code', async () => {
    const descriptor = {
      protocol: 'ooxml-worker-renderer-module/v2',
      moduleUrl: 'https://example.invalid/never-import.mjs',
      exportName: 'renderer',
    } as never;

    await expect(loadWorkerRenderer(descriptor)).rejects.toThrow(
      'Unsupported worker renderer protocol',
    );
  });

  it('rejects modules that do not expose the requested renderer', async () => {
    const source = 'export const different = true;';
    const descriptor = createWorkerRendererModuleDescriptor(
      `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`,
      'renderer',
    );

    await expect(loadWorkerRenderer(descriptor)).rejects.toThrow(
      'does not export "renderer"',
    );
  });

  it('projects only worker-capable renderers into a cloneable wire set', () => {
    const threeD = createWorkerRendererModuleDescriptor(
      'https://example.invalid/three-d.mjs',
      'threeD',
    );
    const mainOnlyMath = {
      worker: undefined,
      loadMathJax: async () => undefined,
      mathMLToSvg: async () => ({ svg: '', widthEm: 0, ascentEm: 0, descentEm: 0 }),
    };
    const descriptors = workerRendererDescriptors({
      math: mainOnlyMath,
      threeD: { worker: threeD },
    });

    expect(structuredClone(descriptors)).toEqual({ threeD });
  });

  it('reconstructs the typed renderer set inside the worker realm', async () => {
    const source = [
      'export const math = { loadMathJax: async () => {}, mathMLToSvg: async () => ({}) };',
      'export const threeD = { render: () => true };',
      'export const regionMap = { render: () => true };',
    ].join('\n');
    const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;

    const loaded = await loadWorkerRenderers({
      math: createWorkerRendererModuleDescriptor(moduleUrl, 'math'),
      threeD: createWorkerRendererModuleDescriptor(moduleUrl, 'threeD'),
      regionMap: createWorkerRendererModuleDescriptor(moduleUrl, 'regionMap'),
    });

    expect(typeof loaded.math?.mathMLToSvg).toBe('function');
    expect(loaded.threeD?.render({} as never, {} as never, {} as never, 1)).toBe(true);
    expect(loaded.regionMap?.render({} as never, {} as never, {} as never, 1)).toBe(true);
  });
});
