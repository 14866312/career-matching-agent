import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiGet, apiPost, apiPostForm } from '../api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('API request options', () => {
  it('passes an AbortSignal through every API helper', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await apiGet('/get', { signal: controller.signal });
    await apiPost('/post', { value: 1 }, { signal: controller.signal });
    await apiPostForm('/form', new FormData(), { signal: controller.signal });

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/get', { signal: controller.signal });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/post', expect.objectContaining({ signal: controller.signal }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/form', expect.objectContaining({ signal: controller.signal }));
  });

  it('preserves AbortError instead of reporting a network failure', async () => {
    const abortError = new DOMException('request aborted', 'AbortError');
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(abortError)));

    await expect(apiGet('/cancelled')).rejects.toBe(abortError);
  });
});
