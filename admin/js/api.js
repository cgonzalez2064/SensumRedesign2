/**
 * API client. JSON in/out, CSRF header on every change, timeouts, and
 * friendly error objects. When a session expires mid-task, the registered
 * re-login handler is shown and the original request is retried — so the
 * user never loses what they were editing.
 */
const BASE = '../api';
let csrf = null;
let reloginHandler = null;

export class ApiError extends Error {
  constructor(status, code, data = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.fields = data.fields || {};
    this.data = data;
  }
}

let twoFactorHandler = null;
let passwordChangeHandler = null;
let viewAsExpected = null;
let viewAsHandler = null;
/** The account the panel is showing ("Ver como"), 0 when it is the person's own. */
export const setViewAsExpected = (id) => { viewAsExpected = id; };
/** Called when an answer shows "Ver como" started, changed or ended (e.g. it expired). */
export const onViewAsChanged = (fn) => { viewAsHandler = fn; };
export const setCsrf = (token) => { csrf = token || null; };
export const onSessionExpired = (fn) => { reloginHandler = fn; };
/** Called when the server says this account must set up two-step sign-in first. */
export const onTwoFactorRequired = (fn) => { twoFactorHandler = fn; };
/** A password someone else gave the account must be replaced first (the panel shows that screen). */
export const onPasswordChangeRequired = (fn) => { passwordChangeHandler = fn; };

async function parse(res) {
  const type = res.headers.get('Content-Type') || '';
  if (type.includes('application/json')) {
    try { return await res.json(); } catch (e) { return null; }
  }
  return null;
}

async function raw(method, path, body, { timeout = 30000, auth = true } = {}) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ApiError(0, 'network');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;
  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin', signal: ctrl.signal, cache: 'no-store' });
  } catch (e) {
    throw new ApiError(0, e && e.name === 'AbortError' ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }
  const va = res.headers.get('X-View-As');
  if (va !== null && viewAsExpected !== null && Number(va) !== viewAsExpected && viewAsHandler) viewAsHandler();
  const data = await parse(res);
  if (res.ok && data && data.ok !== false) return { status: res.status, data };
  const code = (data && data.error) || (res.status >= 500 ? 'service_unavailable' : 'unknown');
  if (code === 'two_factor_setup_required' && twoFactorHandler) twoFactorHandler();
  if (code === 'password_change_required' && passwordChangeHandler) passwordChangeHandler();
  throw new ApiError(res.status, code, data || {});
}

/**
 * POST that answers with a file (e.g. the encrypted backup). Resolves with
 * { blob, filename }; JSON error answers become ApiError like everything else.
 */
export async function download(path, body = {}) {
  const res = await fetch(BASE + path, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { Accept: 'application/zip, application/pdf, text/csv, application/json', 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await parse(res);
    throw new ApiError(res.status, (data && data.error) || 'unknown', data || {});
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
  return { blob: await res.blob(), filename: name ? name[1] : 'descarga' };
}

/** Saves a Blob with a file name (no navigation). */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function requestFull(method, path, body, opts = {}) {
  try {
    return await raw(method, path, body, opts);
  } catch (e) {
    if (e.status === 401 && e.code === 'unauthenticated' && opts.auth !== false && reloginHandler) {
      await reloginHandler(); // resolves after a successful sign-in (new CSRF token set)
      return raw(method, path, body, opts);
    }
    throw e;
  }
}
const request = async (method, path, body, opts) => (await requestFull(method, path, body, opts)).data;

export const api = {
  get: (p, o) => request('GET', p, undefined, o),
  post: (p, b = {}, o) => request('POST', p, b, o),
  put: (p, b = {}, o) => request('PUT', p, b, o),
  del: (p, o) => request('DELETE', p, undefined, o),
  /** Status-aware variant (e.g. 202 = stored but e-mail pending). */
  postWithStatus: (p, b = {}, o) => requestFull('POST', p, b, o),
};

/**
 * Multipart upload with progress (fetch cannot report upload progress).
 * Resolves { status, data }; rejects with ApiError.
 */
export function upload(path, formData, onProgress, { timeout = 180000 } = {}) {
  const send = () => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', BASE + path);
    xhr.timeout = timeout;
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) { data = null; }
      if (xhr.status >= 200 && xhr.status < 300 && data && data.ok !== false) resolve({ status: xhr.status, data });
      else reject(new ApiError(xhr.status, (data && data.error) || (xhr.status === 413 ? 'payload_too_large' : xhr.status >= 500 ? 'service_unavailable' : 'unknown'), data || {}));
    };
    xhr.onerror = () => reject(new ApiError(0, 'network'));
    xhr.ontimeout = () => reject(new ApiError(0, 'timeout'));
    xhr.send(formData);
  });
  return send().catch(async (e) => {
    if (e.status === 401 && e.code === 'unauthenticated' && reloginHandler) {
      await reloginHandler();
      return send();
    }
    throw e;
  });
}
