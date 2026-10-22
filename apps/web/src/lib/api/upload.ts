import { buildUrl, handleResponse, NetworkError } from './client';

export interface UploadOptions {
  /** Upload progress from 0 to 1. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

function headersOf(raw: string): Headers {
  const headers = new Headers();
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const i = line.indexOf(':');
    if (i > 0) headers.append(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  return headers;
}

/**
 * Multipart POST to /api/v1 (document uploads, API-CATALOGUE §9) with the same problem+json, step-up and 401
 * handling as `request`. It uses XMLHttpRequest because fetch reports no upload progress (COMPONENT-SPECS §6); a
 * same-origin XHR without `withCredentials` sends the session cookie exactly like `credentials: 'same-origin'`.
 */
export function upload<T>(path: string, form: FormData, options: UploadOptions = {}): Promise<T> {
  const send = () =>
    new Promise<Response>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', buildUrl(path));
      xhr.withCredentials = false;
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) options.onProgress?.(e.loaded / e.total);
      };
      xhr.onload = () => {
        options.onProgress?.(1);
        const status = xhr.status;
        resolve(
          new Response(status === 204 ? null : xhr.responseText, {
            status,
            statusText: xhr.statusText,
            headers: headersOf(xhr.getAllResponseHeaders()),
          }),
        );
      };
      xhr.onerror = () => reject(new NetworkError());
      xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
      if (options.signal) {
        if (options.signal.aborted) {
          reject(new DOMException('Upload cancelled', 'AbortError'));
          return;
        }
        options.signal.addEventListener('abort', () => xhr.abort(), { once: true });
      }
      options.onProgress?.(0);
      xhr.send(form);
    });
  return handleResponse<T>(path, send, false);
}
