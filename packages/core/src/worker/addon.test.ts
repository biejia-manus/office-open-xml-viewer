import { describe, expect, it } from 'vitest';
import {
  createBuiltinWorkerAddonDescriptor,
  createWorkerAddonDescriptor,
  loadWorkerAddon,
  loadWorkerRenderAddons,
  workerRenderAddons,
  WORKER_ADDON_PROTOCOL,
} from './addon.js';

describe('worker addon descriptors', () => {
  it('remain plain structured-clone-safe data', () => {
    const descriptor = createWorkerAddonDescriptor(
      'https://example.invalid/ooxml-addon.mjs',
      'addon',
    );

    expect(structuredClone(descriptor)).toEqual({
      protocol: WORKER_ADDON_PROTOCOL,
      moduleUrl: 'https://example.invalid/ooxml-addon.mjs',
      exportName: 'addon',
    });
  });

  it('loads built-ins by a bundler-stable identity instead of an export name', async () => {
    const descriptor = createBuiltinWorkerAddonDescriptor('threeD');

    expect(structuredClone(descriptor)).toEqual({
      protocol: WORKER_ADDON_PROTOCOL,
      builtin: 'threeD',
    });
    const addon = await loadWorkerAddon<{ render: unknown }>(descriptor);
    expect(typeof addon.render).toBe('function');
  });

  it('loads the named export inside the current realm', async () => {
    const source = 'export const addon = Object.freeze({ kind: "worker-test" });';
    const descriptor = createWorkerAddonDescriptor(
      `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`,
      'addon',
    );

    await expect(loadWorkerAddon<{ kind: string }>(descriptor)).resolves.toEqual({
      kind: 'worker-test',
    });
  });

  it('rejects incompatible protocols before importing code', async () => {
    const descriptor = {
      protocol: 'ooxml-worker-addon/v2',
      moduleUrl: 'https://example.invalid/never-import.mjs',
      exportName: 'addon',
    } as never;

    await expect(loadWorkerAddon(descriptor)).rejects.toThrow(
      'Unsupported worker addon protocol',
    );
  });

  it('rejects modules that do not expose the requested addon', async () => {
    const source = 'export const different = true;';
    const descriptor = createWorkerAddonDescriptor(
      `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`,
      'addon',
    );

    await expect(loadWorkerAddon(descriptor)).rejects.toThrow(
      'does not export "addon"',
    );
  });

  it('projects only worker-capable addons into a cloneable wire set', () => {
    const threeD = createWorkerAddonDescriptor(
      'https://example.invalid/three-d.mjs',
      'threeD',
    );
    const mainOnlyMath = {
      worker: undefined,
      loadMathJax: async () => undefined,
      mathMLToSvg: async () => ({ svg: '', widthEm: 0, ascentEm: 0, descentEm: 0 }),
    };
    const addons = workerRenderAddons({
      math: mainOnlyMath,
      threeD: { worker: threeD },
    });

    expect(structuredClone(addons)).toEqual({ threeD });
  });

  it('reconstructs the typed render-addon set inside the worker realm', async () => {
    const source = [
      'export const math = { loadMathJax: async () => {}, mathMLToSvg: async () => ({}) };',
      'export const threeD = { render: () => true };',
      'export const regionMap = { render: () => true };',
    ].join('\n');
    const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;

    const loaded = await loadWorkerRenderAddons({
      math: createWorkerAddonDescriptor(moduleUrl, 'math'),
      threeD: createWorkerAddonDescriptor(moduleUrl, 'threeD'),
      regionMap: createWorkerAddonDescriptor(moduleUrl, 'regionMap'),
    });

    expect(typeof loaded.math?.mathMLToSvg).toBe('function');
    expect(loaded.threeD?.render({} as never, {} as never, {} as never, 1)).toBe(true);
    expect(loaded.regionMap?.render({} as never, {} as never, {} as never, 1)).toBe(true);
  });
});
