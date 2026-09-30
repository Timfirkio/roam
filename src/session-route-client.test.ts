import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class TestWorker extends EventTarget {
  static instances: TestWorker[] = [];
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { super(); TestWorker.instances.push(this); }
  reply(data: unknown) { this.dispatchEvent(new MessageEvent('message', { data })); }
}

describe('session route worker', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    TestWorker.instances = [];
    vi.stubGlobal('Worker', TestWorker);
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('routes concurrent responses to the right callers and releases idle resources', async () => {
    const { loadSessionRoute } = await import('./session-route-client');
    expect(TestWorker.instances).toHaveLength(0);
    const first = loadSessionRoute([]);
    const second = loadSessionRoute([]);
    expect(TestWorker.instances).toHaveLength(1);
    const worker = TestWorker.instances[0];
    const firstId = worker.postMessage.mock.calls[0][0].id;
    const secondId = worker.postMessage.mock.calls[1][0].id;
    worker.reply({ id: secondId, error: 'Tile unavailable' });
    await expect(second).rejects.toThrow('Tile unavailable');
    vi.advanceTimersByTime(30_000);
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.reply({ id: firstId, route: [] });
    await expect(first).resolves.toEqual([]);
    vi.advanceTimersByTime(30_000);
    expect(worker.terminate).toHaveBeenCalledOnce();
    const next = loadSessionRoute([]);
    expect(TestWorker.instances).toHaveLength(2);
    const replacement = TestWorker.instances[1];
    replacement.reply({ id: replacement.postMessage.mock.calls[0][0].id, route: [] });
    await next;
  });

  it('rejects outstanding requests on a worker crash and can retry', async () => {
    const { loadSessionRoute } = await import('./session-route-client');
    const pending = loadSessionRoute([]);
    const worker = TestWorker.instances[0];
    worker.dispatchEvent(new Event('error'));
    await expect(pending).rejects.toThrow('Could not calculate the session route');
    expect(worker.terminate).toHaveBeenCalledOnce();
    const retry = loadSessionRoute([]);
    const replacement = TestWorker.instances[1];
    replacement.reply({ id: replacement.postMessage.mock.calls[0][0].id, route: [] });
    await expect(retry).resolves.toEqual([]);
  });
});
