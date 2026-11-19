import fs from 'node:fs';
import module, { createRequire, isBuiltin } from 'node:module';
import type { LoadHookSync, ModuleFormat, ResolveHookSync } from 'node:module';
import process from 'node:process';
import type * as ResolvePkgMaps from 'resolve-pkg-maps';
import {
    getFileFormat,
    readPackage,
    readPackageScope,
    resolveBuiltin
} from './internal/packages.ts';
import {
    appendUrlSearchAndHash,
    extnameFromUrl,
    fileUrlToPath,
    isFileUrl,
    isRelativeOrAbsoluteSpecifier,
    normalizePath,
    pathToFileUrl
} from './internal/url.ts';

interface PnpApi {
    resolveToUnqualified(request: string, issuer: string | null): string;
}

// Yarn's runtime, `.pnp.cjs`, adds findPnpApi when it's loaded
const findPnpApi = (
    module as typeof module & {
        findPnpApi?: (specifier: string) => PnpApi | null;
    }
).findPnpApi;

/**
 * Resolves packages with Yarn PnP's API and the `exports` and `imports` of
 * their package.json, and files without an extension as CommonJS does.
 * Defers to the next hook what it can't resolve.
 */
export const resolve: ResolveHookSync = (specifier, context, nextResolve) => {
    if (isBuiltin(specifier)) {
        return resolveBuiltin(specifier);
    }

    const { parentURL, conditions } = context;

    const issuer = parentURL ?? pathToFileUrl(`${process.cwd()}/`);

    let resolved: string | undefined;

    if (isRelativeOrAbsoluteSpecifier(specifier)) {
        resolved = new URL(specifier, issuer).href;
    } else if (specifier[0] === '#') {
        resolved = resolvePrivateRequest(specifier, issuer, conditions);
        if (resolved === undefined) {
            return nextResolve(specifier, context);
        }
    } else {
        resolved = resolveRequest(specifier, issuer, conditions);
        if (resolved === undefined) {
            return nextResolve(specifier, context);
        }
    }

    resolved = resolveWithExtension(resolved);
    if (resolved === undefined) {
        return nextResolve(specifier, context);
    }

    return {
        url: appendUrlSearchAndHash(resolved, specifier, parentURL),
        format: getFileFormat(resolved),
        shortCircuit: true
    };
};

/** Reads files through fs, which Yarn PnP patches to read zip archives */
export const load: LoadHookSync = (urlString, context, nextLoad) => {
    if (!isFileUrl(urlString)) {
        return nextLoad(urlString, context);
    }

    const format = (context.format ??
        getFileFormat(urlString)) as ModuleFormat | null;
    if (!format) {
        return nextLoad(urlString, context);
    }

    const filePath = fileUrlToPath(urlString);

    return {
        format,
        // Wasm is binary and must not be decoded as UTF-8
        source:
            format === 'wasm'
                ? fs.readFileSync(filePath)
                : fs.readFileSync(filePath, 'utf8'),
        shortCircuit: true
    };
};

function resolveRequest(
    specifier: string,
    issuer: string,
    conditions: string[]
): string | undefined {
    const sliceIndex = specifier[0] === '@' ? 2 : 1;
    const parts = specifier.split('/');
    const packageName = parts.slice(0, sliceIndex).join('/');
    const subpath = parts.slice(sliceIndex).join('/');

    const unqualified = tryResolveToUnqualified(packageName, specifier, issuer);
    if (unqualified === undefined || unqualified === '') {
        return;
    }

    // PnP returns the package's root, whose package.json can name another
    // package, as under an alias such as `npm:other@1`, or none at all
    const pkg = readPackage(unqualified);
    if (!pkg) {
        return;
    }

    let resolvedImport: string | undefined;

    if (pkg.exports) {
        const { resolveExports } = loadResolvePkgMaps();
        [resolvedImport] = resolveExports(pkg.exports, subpath, conditions);
    } else {
        resolvedImport = subpath || (pkg.main ?? 'index.js');
    }

    if (!resolvedImport) {
        return;
    }

    const url = new URL(resolvedImport, pathToFileUrl(`${unqualified}/`));
    return url.href;
}

function tryResolveToUnqualified(
    packageName: string,
    specifier: string,
    issuer: string
): string | undefined {
    if (!findPnpApi) {
        return;
    }

    const issuerPath = fileUrlToPath(issuer);
    const pnpapi = findPnpApi(issuerPath) ?? findPnpApi(specifier);
    if (!pnpapi) {
        return;
    }

    try {
        const resolved = pnpapi.resolveToUnqualified(packageName, issuerPath);
        return normalizePath(resolved.slice(0, -1));
    } catch {}
}

function resolvePrivateRequest(
    specifier: string,
    issuer: string,
    conditions: string[]
): string | undefined {
    const pkg = readPackageScope(issuer);
    if (!pkg?.imports) {
        return;
    }

    const { resolveImports } = loadResolvePkgMaps();
    const [resolvedImport] = resolveImports(pkg.imports, specifier, conditions);
    if (!resolvedImport || isBuiltin(resolvedImport)) {
        return;
    }

    const url = new URL(resolvedImport, pathToFileUrl(`${pkg.directory}/`));
    return url.href;
}

const blessedExtensions = new Set([
    '.cjs',
    '.cts',
    '.js',
    '.json',
    '.mjs',
    '.mts',
    '.node',
    '.ts',
    '.tsx',
    '.wasm'
]);

const extensions = ['.js', '.ts', '.json'];

function resolveWithExtension(urlString: string): string | undefined {
    if (blessedExtensions.has(extnameFromUrl(urlString))) {
        return urlString;
    }

    const format = getFileFormat(urlString);
    if (format === 'module') {
        return urlString;
    }

    const filePath = fileUrlToPath(urlString);
    if (isFile(filePath)) {
        return urlString;
    }

    const endsWithSlash = filePath.at(-1) === '/';

    if (!endsWithSlash) {
        for (const extension of extensions) {
            const maybeFilePath = `${filePath}${extension}`;
            if (isFile(maybeFilePath)) {
                return pathToFileUrl(maybeFilePath);
            }
        }
    }

    for (const extension of extensions) {
        const maybeFilePath = `${filePath}/index${extension}`;
        if (isFile(maybeFilePath)) {
            return pathToFileUrl(maybeFilePath);
        }
    }
}

function isFile(path: string): boolean {
    return fs.statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
}

let resolvePkgMaps: typeof ResolvePkgMaps | undefined;

/**
 * Loads the optional peer dependency resolve-pkg-maps. It's resolved through
 * PnP's API and required by path, since requiring it by name would run these
 * hooks, which need it to resolve a package name.
 */
function loadResolvePkgMaps(): typeof ResolvePkgMaps {
    if (resolvePkgMaps) {
        return resolvePkgMaps;
    }

    const resolved = tryResolveToUnqualified(
        'resolve-pkg-maps',
        'resolve-pkg-maps',
        import.meta.url
    );
    if (resolved === undefined || resolved === '') {
        throw new Error(
            "@snovader/node-hooks/pnp needs its peer dependency 'resolve-pkg-maps' to resolve packages' exports and imports"
        );
    }

    const require = createRequire(import.meta.url);
    resolvePkgMaps = require(resolved) as typeof ResolvePkgMaps;

    return resolvePkgMaps;
}
