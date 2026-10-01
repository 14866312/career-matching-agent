export interface LatestRequest {
  begin(): number;
  isLatest(requestId: number): boolean;
}

export function createLatestRequest(): LatestRequest {
  let latestRequestId = 0;
  return {
    begin() {
      latestRequestId += 1;
      return latestRequestId;
    },
    isLatest(requestId) {
      return requestId === latestRequestId;
    }
  };
}
