import { type DocumentMimeType, documentMimeTypeValues } from '@hrm/contracts';

// COMPONENT-SPECS §6 and API-CATALOGUE §9: the browser checks type and size before uploading; the server checks
// again by magic bytes. 10 MB is the Worker's request limit (ADR-0009) and the default `documents.max_upload_mb`.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const RESIZE_LONG_EDGE = 1600;
export const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp';
export const RULE_LINE = 'PDF, JPG or PNG, up to 10 MB';

const EXTENSIONS: Record<string, DocumentMimeType> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** `284 KB`, `1.2 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type FileProblem = 'type' | 'size';

/** The client-side check: extension and declared type must both be allowed and agree; size within the limit. */
export function checkFile(file: { name: string; type: string; size: number }): FileProblem | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const expected = EXTENSIONS[ext];
  if (!expected) return 'type';
  if (file.type && !(documentMimeTypeValues as readonly string[]).includes(file.type)) return 'type';
  if (file.type && file.type !== expected) return 'type';
  if (file.size === 0) return 'type';
  if (file.size > MAX_UPLOAD_BYTES) return 'size';
  return null;
}

/** CONTENT-STYLE §6 copy for the upload row. */
export function fileProblemMessage(problem: FileProblem, size: number): string {
  return problem === 'size'
    ? `This file is ${formatBytes(size)}. The limit is 10 MB.`
    : "This file type isn't allowed. Use PDF, JPG or PNG.";
}

/**
 * Images whose long edge is over 1600 px are scaled down in the browser before upload (COMPONENT-SPECS §6, ADR-0009
 * guardrail). Returns the original file for PDFs, small images, or when the browser cannot decode the image.
 */
export async function prepareFile(file: File): Promise<{ file: File; resized: boolean }> {
  if (!file.type.startsWith('image/') || typeof createImageBitmap !== 'function') {
    return { file, resized: false };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { file, resized: false };
  }
  const longEdge = Math.max(bitmap.width, bitmap.height);
  if (longEdge <= RESIZE_LONG_EDGE) {
    bitmap.close();
    return { file, resized: false };
  }
  const scale = RESIZE_LONG_EDGE / longEdge;
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return { file, resized: false };
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, file.type, 0.85));
  if (!blob || blob.type !== file.type) return { file, resized: false };
  return {
    file: new File([blob], file.name, { type: file.type, lastModified: file.lastModified }),
    resized: true,
  };
}
