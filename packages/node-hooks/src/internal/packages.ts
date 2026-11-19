import fs from 'node:fs';
import type { ModuleFormat, ResolveFnOutput } from 'node:module';
import path from 'node:path/posix';
import type { PathConditionsMap } from 'resolve-pkg-maps';
import { extnameFromUrl, fileUrlToPath, pathRootLength } from './url.ts';

export interface PackageData {
    directory: string;
    exports?: PathConditionsMap;
    imports?: PathConditionsMap;
    main?: string;
    module?: string;
    type?: ModuleFormat;
}

const packageCache = new Map<string, PackageData | false>();

/**
 * Finds the nearest package.json above a file without leaving the file's
 * `node_modules` directory.
 */
export function readPackageScope(urlString: string): PackageData | undefined {
    let currentPath = fileUrlToPath(urlString);
    // Past a Windows drive's root, path.dirname gives the relative "."
    const rootLength = pathRootLength(currentPath);

    while (true) {
        const dirname = path.dirname(currentPath);
        if (
            dirname === currentPath ||
            dirname.length < rootLength ||
            dirname.endsWith('/node_modules')
        ) {
            return;
        }

        const packageData = readPackage(dirname);
        if (packageData) {
            return packageData;
        }

        currentPath = dirname;
    }
}

/** Reads the package.json in a directory, a path with forward slashes */
export function readPackage(directory: string): PackageData | undefined {
    const packageData = packageCache.getOrInsertComputed(directory, () => {
        try {
            // path.join would turn the // of a UNC share into /
            const content = fs.readFileSync(
                `${directory === '/' ? '' : directory}/package.json`,
                'utf8'
            );

            const { type, main, module, exports, imports } = JSON.parse(
                content
            ) as PackageData;

            return { directory, type, main, module, exports, imports };
        } catch {
            return false;
        }
    });

    return packageData || undefined;
}

/**
 * Determines a file's format from its extension and package type. TypeScript
 * files load as ES modules unless their package's type is `commonjs`, where
 * Node would detect the syntax of a file in a package without a type.
 */
export function getFileFormat(urlString: string): ModuleFormat | null {
    const ext = extnameFromUrl(urlString);

    switch (ext) {
        case '.mjs':
            return 'module';

        case '.cjs':
            return 'commonjs';

        case '.mts':
            return 'module-typescript';

        case '.cts':
            return 'commonjs-typescript';

        case '.ts':
        case '.tsx':
            return readPackageScope(urlString)?.type === 'commonjs'
                ? 'commonjs-typescript'
                : 'module-typescript';

        case '.json':
            return 'json';

        case '.node':
            return 'addon';

        case '.wasm':
            return 'wasm';

        default:
            return readPackageScope(urlString)?.type ?? 'commonjs';
    }
}

export function resolveBuiltin(specifier: string): ResolveFnOutput {
    return {
        url: specifier.startsWith('node:') ? specifier : `node:${specifier}`,
        format: 'builtin',
        shortCircuit: true
    };
}
