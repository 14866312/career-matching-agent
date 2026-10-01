import { describe, expect, it } from 'vitest';
import { createLatestRequest } from '../lib/latestRequest';

describe('latest request', () => {
  it('only treats the most recently started request as current', () => {
    const requests = createLatestRequest();
    const first = requests.begin();
    expect(requests.isLatest(first)).toBe(true);

    const second = requests.begin();
    expect(requests.isLatest(first)).toBe(false);
    expect(requests.isLatest(second)).toBe(true);
  });
});
