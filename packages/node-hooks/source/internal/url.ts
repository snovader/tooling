import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The hooks run for every module, so the common case of a plain URL or path
// is converted with string operations rather than by parsing a URL.
const fileExtensionPattern = /(\.[^#./?]+)(?:$|\?|#)/u;
const searchOrTrailingHashPattern = /\?|#$/u;
const encodedUrlPattern = /\?|#|%/u;
const uncRootPattern = /^\/\/[^/]*\/[^/]*/u;

const isWindows = process.platform === 'win32';

// An absolute path that a URL keeps as it is, which on Windows is on a drive
const plainPathPattern = isWindows
    ? /^[A-Za-z]:\/[/:\w.-]*$/u
    : /^\/[/:\w.-]*$/u;

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
 * handles on every platform: `/dir/file`, or on Windows `C:/dir/file` and
 * `//server/share/file`. Search and hash are dropped.
 */
export function fileUrlToPath(urlString: string): string {
    // A plain URL without a host, which on Windows starts with a drive letter
    if (
        urlString.startsWith('file:///') &&
        !encodedUrlPattern.test(urlString)
    ) {
        if (!isWindows) {
            return urlString.slice('file://'.length);
        }

        if (urlString[9] === ':') {
            return urlString.slice('file:///'.length);
        }
    }

    // Node decodes the URL, finds a UNC share in a host, and rejects a Windows
    // path without a drive letter or a host on POSIX
    return normalizePath(fileURLToPath(urlString, { windows: isWindows }));
}

/**
 * Measures the root of a path from `fileUrlToPath`, which is the last
 * directory that a walk up its parents reaches: `/`, or on Windows a drive's
 * `C:` or a UNC share's `//server/share`.
 */
export function pathRootLength(path: string): number {
    if (!isWindows) {
        return 1;
    }

    if (path[1] === ':') {
        return 2;
    }

    return uncRootPattern.exec(path)?.[0].length ?? path.length;
}

export function pathToFileUrl(path: string): string {
    const normalizedPath = normalizePath(path);

    if (plainPathPattern.test(normalizedPath)) {
        return isWindows
            ? `file:///${normalizedPath}`
            : `file://${normalizedPath}`;
    }

    return pathToFileURL(normalizedPath, { windows: isWindows }).href;
}

/** Carries a specifier's search and hash over to the URL it resolved to */
export function appendUrlSearchAndHash(
    urlString: string,
    specifier: string,
    base?: string
): string {
    if (searchOrTrailingHashPattern.test(specifier)) {
        const parsedUrl = URL.parse(specifier, base);
        if (
            parsedUrl !== null &&
            (parsedUrl.search !== '' || parsedUrl.hash !== '')
        ) {
            const url = new URL(
                `${parsedUrl.search}${parsedUrl.hash}`,
                urlString
            );
            return url.href;
        }
    }

    return urlString;
}

/**
 * Turns a Windows path's backslashes into forward slashes. Elsewhere a
 * backslash belongs to a file name, and the path stays as it is.
 */
export function normalizePath(path: string): string {
    return isWindows ? path.replaceAll('\\', '/') : path;
}
