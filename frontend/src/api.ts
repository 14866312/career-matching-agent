export class ApiError extends Error {
  code: string;
  retryable: boolean;
  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

async function request<T>(path: string, opt: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, opt);
  } catch {
    throw new ApiError('NETWORK', '无法连接后端服务，请确认本地服务已启动后重试。', true);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; retryable?: boolean } } | null)?.error;
    throw new ApiError(
      err?.code ?? 'HTTP_' + res.status,
      err?.message ?? '请求失败（HTTP ' + res.status + '），请稍后重试。',
      !!(err?.retryable) || res.status >= 500
    );
  }
  return data as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

export function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  return request<T>(path, { method: 'POST', body: form });
}

export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function isRetryable(e: unknown): boolean {
  return e instanceof ApiError && e.retryable;
}

export function errCode(e: unknown): string {
  return e instanceof ApiError ? e.code : 'UNKNOWN';
}

