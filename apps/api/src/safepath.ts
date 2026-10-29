import path from 'node:path';

/**
 * Safepath utility to prevent directory traversal and path manipulation attacks.
 * Guarantees that any user-supplied path strictly resolves within the specified base directory.
 */
export const safepath = {
  resolve(baseDir: string, ...segments: string[]): string {
    const resolvedBase = path.resolve(baseDir);
    const cleanSegments = segments.map((s) => s.replace(/\0/g, ''));
    const resolvedPath = path.resolve(resolvedBase, ...cleanSegments);

    const baseWithSep = resolvedBase.endsWith(path.sep) ? resolvedBase : resolvedBase + path.sep;
    if (resolvedPath !== resolvedBase && !resolvedPath.startsWith(baseWithSep)) {
      const error = new Error('Access denied: path traversal detected');
      (error as Error & { code: string; statusCode: number }).code = 'FORBIDDEN_PATH';
      (error as Error & { statusCode: number }).statusCode = 403;
      throw error;
    }

    return resolvedPath;
  },
};
