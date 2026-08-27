import { describe, expect, it, vi } from 'vitest';
import type { WorkerBridgeTransport } from '@silurus/ooxml-core';
import {
  PULL_SESSION_PROTOCOL,
  type PullSessionCommand,
  type PullSessionResponse,
} from '@silurus/ooxml-core/worker';
import { PptxPresentation } from './presentation.js';
import type {
  PptxWorkerRequest,
  RenderWorkerRequest,
  RenderWorkerResponse,
} from './worker-protocol.js';
import type { Slide } from './types.js';

type PullResponse = PullSessionResponse<ArrayBuffer, number>;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function slide(index: number): Slide {
  return {
    index,
    slideNumber: index + 1,
    partName: `ppt/slides/slide${index + 1}.xml`,
    background: null,
    elements: [],
    notes: `notes-${index + 1}`,
  };
}

function pullResponse(
  command: PullSessionCommand<number>,
  value: Record<string, unknown>,
): PullResponse {
  return {
    protocol: PULL_SESSION_PROTOCOL,
    sessionId: command.sessionId,
    operationId: command.operationId,
    generation: command.generation,
    requestId: command.requestId,
    ...value,
  } as PullResponse;
}

describe('PptxPresentation progressive layout lifecycle', () => {
  it('accepts worker-mode prefix pushes before the correlated final response', async () => {
    const finalResponse = deferred<RenderWorkerResponse>();
    const bootstrap = {
      slideCount: 2,
      slideWidth: 9144000,
      slideHeight: 6858000,
      defaultTextColor: null,
      majorFont: null,
      minorFont: null,
      hlinkColor: null,
      folHlinkColor: null,
      embeddedFonts: [],
      slides: [0, 1].map((index) => ({
        index,
        partName: `ppt/slides/slide${index + 1}.xml`,
      })),
    } as const;
    const slideFacts = [0, 1].map((index) => ({
      index,
      partName: `ppt/slides/slide${index + 1}.xml`,
      notes: `notes-${index + 1}`,
      hidden: false,
      mediaElements: [],
    }));
    const bridge = {
      request: (build: (id: number) => RenderWorkerRequest) => {
        const request = build(41);
        expect(request).toMatchObject({ kind: 'parse', id: 41, progressiveLayout: true });
        return finalResponse.promise;
      },
    };
    const instance = Object.create(PptxPresentation.prototype) as Record<string, unknown>;
    Object.assign(instance, {
      _mode: 'worker',
      _bridge: bridge,
      _destroyed: false,
      _layoutWaiters: new Set(),
      _availableSlideCount: 0,
      _layoutComplete: true,
      _layoutError: undefined,
      _parseRequestId: null,
      _progressive: null,
      _metrics: null,
    });
    const presentation = instance as unknown as PptxPresentation;
    const lifecycle = {
      firstPublication: deferred<void>(),
      published: false,
      settled: false,
    };
    const policy = { maxArchiveEntryBytes: null, maxTotalInflatedBytes: null } as const;

    const parsing = (presentation as unknown as {
      _parse(
        buffer: ArrayBuffer,
        resourcePolicy: typeof policy,
        useGoogleFonts: boolean,
        timeoutMs: undefined,
        onUsage: undefined,
        renderers: undefined,
        progressive: typeof lifecycle,
      ): Promise<void>;
    })._parse(new ArrayBuffer(4), policy, false, undefined, undefined, undefined, lifecycle);
    await Promise.resolve();

    (presentation as unknown as {
      _onWorkerLayoutPush(response: RenderWorkerResponse): void;
    })._onWorkerLayoutPush({
      kind: 'presentationLayoutPartial',
      forId: 41,
      bootstrap,
      availableSlides: 1,
      slide: slideFacts[0],
      fontPreloadNames: [],
    });
    await parsing;
    expect(presentation.slideCount).toBe(2);
    expect(presentation.availableSlideCount).toBe(1);
    expect(presentation.layoutComplete).toBe(false);

    finalResponse.resolve({
      kind: 'presentationReady',
      id: 41,
      preflight: {
        ...bootstrap,
        slides: slideFacts,
        fontPreloadNames: [],
      },
    });
    await presentation.waitUntilLayoutComplete();
    expect(presentation.availableSlideCount).toBe(2);
    expect(presentation.layoutComplete).toBe(true);
  });

  it('publishes the opening slide while keeping the final slide count stable', async () => {
    const releaseSecondSlide = deferred<void>();
    const slideIndexBySession = new Map<number, number>();
    let pullRequestId = 1;
    const transport: WorkerBridgeTransport<PullResponse> = {
      request: async (build) => {
        const command = build(pullRequestId++) as PullSessionCommand<number>;
        if (command.kind === 'pull') {
          const index = slideIndexBySession.get(command.sessionId);
          if (index === undefined) throw new Error('missing slide session');
          if (index === 1) await releaseSecondSlide.promise;
          const payload = new TextEncoder().encode(JSON.stringify(slide(index))).buffer;
          return pullResponse(command, {
            kind: 'chunk',
            sequence: command.sequence,
            byteLength: payload.byteLength,
            done: true,
            payload,
          });
        }
        return pullResponse(command, { kind: 'accepted', command: command.kind });
      },
      forgetOrphaned: () => undefined,
      terminate: () => undefined,
    };
    const bootstrap = {
      slideCount: 3,
      slideWidth: 9144000,
      slideHeight: 6858000,
      defaultTextColor: '111111',
      majorFont: 'Aptos Display',
      minorFont: 'Aptos',
      hlinkColor: '0563C1',
      folHlinkColor: null,
      embeddedFonts: [],
      slides: [0, 1, 2].map((index) => ({
        index,
        partName: `ppt/slides/slide${index + 1}.xml`,
      })),
    } as const;
    let ordinaryId = 100;
    const bridge = {
      request: async (build: (id: number) => PptxWorkerRequest) => {
        const request = build(ordinaryId++);
        if (request.kind === 'parse') {
          expect(request.progressiveLayout).toBe(true);
          return { kind: 'presentationOpened', id: request.id, bootstrap };
        }
        if (request.kind === 'openSlideSession') {
          slideIndexBySession.set(request.sessionId, request.slideIndex);
          return {
            kind: 'slideSessionOpened',
            id: request.id,
            sessionId: request.sessionId,
            operationId: request.operationId,
            generation: request.generation,
          };
        }
        throw new Error(`unexpected request ${request.kind}`);
      },
      transport: () => transport,
    };
    const instance = Object.create(PptxPresentation.prototype) as Record<string, unknown>;
    instance._mode = 'main';
    instance._bridge = bridge;
    instance._googleFontFaces = [];
    instance._embeddedFontFaces = [];
    instance._embeddedFontAliases = new Map();
    instance._embeddedFontAuthoredFamilies = new Map();
    instance._destroyed = false;
    instance._layoutWaiters = new Set();
    const presentation = instance as unknown as PptxPresentation;
    const partials: number[] = [];
    const completions: unknown[] = [];
    const policy = {
      maxArchiveEntryBytes: null,
      maxTotalInflatedBytes: null,
    } as const;

    await (presentation as unknown as {
      _parse(
        buffer: ArrayBuffer,
        resourcePolicy: typeof policy,
        useGoogleFonts: boolean,
        timeoutMs: undefined,
        onUsage: undefined,
        renderers: undefined,
        progressive: {
          onPartial: (progress: { availableSlides: number }) => void;
          onComplete: (error?: unknown) => void;
          firstPublication: ReturnType<typeof deferred<void>>;
          published: boolean;
          settled: boolean;
        },
      ): Promise<void>;
    })._parse(
      new ArrayBuffer(4),
      policy,
      false,
      undefined,
      undefined,
      undefined,
      {
        onPartial: ({ availableSlides }) => partials.push(availableSlides),
        onComplete: (error) => completions.push(error),
        firstPublication: deferred<void>(),
        published: false,
        settled: false,
      },
    );

    expect(presentation.slideCount).toBe(3);
    expect(presentation.availableSlideCount).toBe(1);
    expect(presentation.layoutComplete).toBe(false);
    expect(presentation.getNotes(0)).toBe('notes-1');
    expect(presentation.getNotes(1)).toBeNull();
    expect(partials).toEqual([]);

    let completed = false;
    const completion = presentation.waitUntilLayoutComplete().then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);

    releaseSecondSlide.resolve();
    await completion;

    expect(presentation.availableSlideCount).toBe(3);
    expect(presentation.layoutComplete).toBe(true);
    expect(presentation.getNotes(1)).toBe('notes-2');
    expect(partials).toEqual([2, 3]);
    expect(completions).toEqual([undefined]);
  });

  it('rethrows a background failure after the opening slide was published', async () => {
    const releaseFailure = deferred<void>();
    const slideIndexBySession = new Map<number, number>();
    let pullRequestId = 1;
    const transport: WorkerBridgeTransport<PullResponse> = {
      request: async (build) => {
        const command = build(pullRequestId++) as PullSessionCommand<number>;
        if (command.kind === 'pull') {
          const index = slideIndexBySession.get(command.sessionId);
          if (index === undefined) throw new Error('missing slide session');
          if (index === 1) {
            await releaseFailure.promise;
            throw new Error('later slide failed');
          }
          const payload = new TextEncoder().encode(JSON.stringify(slide(index))).buffer;
          return pullResponse(command, {
            kind: 'chunk', sequence: command.sequence,
            byteLength: payload.byteLength, done: true, payload,
          });
        }
        return pullResponse(command, { kind: 'accepted', command: command.kind });
      },
      forgetOrphaned: () => undefined,
      terminate: () => undefined,
    };
    const bootstrap = {
      slideCount: 2,
      slideWidth: 9144000,
      slideHeight: 6858000,
      defaultTextColor: null,
      majorFont: null,
      minorFont: null,
      hlinkColor: null,
      folHlinkColor: null,
      embeddedFonts: [],
      slides: [0, 1].map((index) => ({ index, partName: `ppt/slides/slide${index + 1}.xml` })),
    } as const;
    let ordinaryId = 100;
    const bridge = {
      request: async (build: (id: number) => PptxWorkerRequest) => {
        const request = build(ordinaryId++);
        if (request.kind === 'parse') return { kind: 'presentationOpened', id: request.id, bootstrap };
        if (request.kind === 'openSlideSession') {
          slideIndexBySession.set(request.sessionId, request.slideIndex);
          return {
            ...request,
            kind: 'slideSessionOpened' as const,
          };
        }
        throw new Error(`unexpected request ${request.kind}`);
      },
      transport: () => transport,
    };
    const instance = Object.create(PptxPresentation.prototype) as Record<string, unknown>;
    Object.assign(instance, {
      _mode: 'main', _bridge: bridge, _googleFontFaces: [], _embeddedFontFaces: [],
      _embeddedFontAliases: new Map(), _embeddedFontAuthoredFamilies: new Map(),
      _destroyed: false, _layoutWaiters: new Set(),
    });
    const presentation = instance as unknown as PptxPresentation;
    const failures: unknown[] = [];
    const policy = { maxArchiveEntryBytes: null, maxTotalInflatedBytes: null } as const;

    await (presentation as unknown as {
      _parse(
        buffer: ArrayBuffer,
        resourcePolicy: typeof policy,
        useGoogleFonts: boolean,
        timeoutMs: undefined,
        onUsage: undefined,
        renderers: undefined,
        progressive: {
          onComplete: (error?: unknown) => void;
          firstPublication: ReturnType<typeof deferred<void>>;
          published: boolean;
          settled: boolean;
        },
      ): Promise<void>;
    })._parse(new ArrayBuffer(4), policy, false, undefined, undefined, undefined, {
      onComplete: (error) => failures.push(error),
      firstPublication: deferred<void>(),
      published: false,
      settled: false,
    });

    releaseFailure.resolve();
    await expect(presentation.waitUntilLayoutComplete()).rejects.toThrow('later slide failed');
    expect(presentation.layoutComplete).toBe(true);
    expect(failures[0]).toBeInstanceOf(Error);
  });
});
