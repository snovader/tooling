import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The hooks run for every module, so the common case of a plain URL or path
// is converted with string operations rather than by parsing a URL.
const fileExtensionPattern = /(\.[^#./?]+)(?:$|\?|#)/;
const searchOrTrailingHashPattern = /\?|#$/;
const encodedUrlPattern = /\?|#|%/;
const plainPathPattern = /^[/:\w.-]+$/;

const isWindows = process.platform === 'win32';

export function extnameFromUrl(urlString: string): string {
    return fileExtensionPattern.exec(urlString)?.[1] ?? '';
}

export function isFileUrl(urlString: string): boolean {
    return urlString.startsWith('file:');
}

export function isRelativeOrAbsoluteSpecifier(specifier: string): boolean {
    return specifier[0] === '.' || specifier[0] === '/' || isFileUrl(specifier);
}

/**
 * Converts a file URL to a path with forward slashes, which `node:path/posix`
 * handles on every platform. Search and hash are dropped.
 */
export function fileUrlToPath(urlString: string): string {
    if (encodedUrlPattern.test(urlString)) {
        const path = fileURLToPath(urlString);
        return isWindows ? normalizePath(path) : path;
    }

    // A Windows path has a drive letter after file:///, as in file:///C:/
    return urlString[9] === ':'
        ? urlString.slice(8 /* file:/// */)
        : urlString.slice(7 /* file:// */);
}

export function pathToFileUrl(path: string): string {
    const normalizedPath = path.includes('\\') ? normalizePath(path) : path;

    if (plainPathPattern.test(normalizedPath)) {
        return normalizedPath[1] === ':'
            ? `file:///${normalizedPath}`
            : `file://${normalizedPath}`;
    }

    return pathToFileURL(normalizedPath).href;
}

/** Carries a specifier's search and hash over to the URL it resolved to */
export function appendUrlSearchAndHash(
    urlString: string,
    specifier: string,
    base?: string
): string {
    if (searchOrTrailingHashPattern.test(specifier)) {
        const parsedUrl = URL.parse(specifier, base);
        if (parsedUrl?.search || parsedUrl?.hash) {
            const url = new URL(
                `${parsedUrl.search}${parsedUrl.hash}`,
                urlString
            );
            return url.href;
        }
    }

    return urlString;
}

export function normalizePath(path: string): string {
    return path.replace(/\\/g, '/');
}
