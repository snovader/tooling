import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import type { LoadHookSync } from 'node:module';
import process from 'node:process';
import type {
    JsxOptions,
    OxcError,
    TransformOptions,
    TransformResult
} from 'oxc-transform';
import { getFileFormat } from './internal/packages.ts';
import { extnameFromUrl, fileUrlToPath, isFileUrl } from './internal/url.ts';

export interface TypeScriptHookOptions {
    /**
     * Compiles `.tsx` files with these options of oxc's JSX transform, such as
     * `{ importSource: 'preact' }`. Without them, `.tsx` files go to the next
     * hook, as Node doesn't load them.
     */
    jsx?: JsxOptions;
}

type TypeScriptFormat = 'commonjs' | 'module';

/** Leaves the syntax that this version of Node runs as it is */
const target = `node${process.versions.node}`;

/**
 * Creates a load hook that strips the types of `.ts`, `.mts`, and `.cts`
 * files with oxc, and compiles `.tsx` files when given JSX options.
 */
export function createLoadHook(
    options: TypeScriptHookOptions = {}
): LoadHookSync {
    const { jsx } = options;

    return (urlString, context, nextLoad) => {
        const lang = languageOf(urlString, jsx);
        if (!lang) {
            return nextLoad(urlString, context);
        }

        const format = typeScriptFormat(urlString, context.format);

        return {
            format,
            source: transformFile(urlString, {
                lang,
                sourceType: format,
                target,
                typescript: { onlyRemoveTypeImports: true },
                jsx,
                sourcemap: process.sourceMapsEnabled
            }),
            shortCircuit: true
        };
    };
}

/** Strips the types of `.ts`, `.mts`, and `.cts` files */
export const load: LoadHookSync = createLoadHook();

/** Finds the language of a file that the hook compiles */
function languageOf(
    urlString: string,
    jsx: JsxOptions | undefined
): 'ts' | 'tsx' | undefined {
    if (!isFileUrl(urlString)) {
        return;
    }

    switch (extnameFromUrl(urlString)) {
        case '.ts':
        case '.mts':
        case '.cts':
            return 'ts';

        case '.tsx':
            return jsx ? 'tsx' : undefined;

        default:
            return;
    }
}

/**
 * Follows the format that resolution gave the file, which Node's resolver
 * sets for a file with a package type or a `.mts` or `.cts` extension, and
 * the package type otherwise.
 */
function typeScriptFormat(
    urlString: string,
    format: string | null | undefined
): TypeScriptFormat {
    switch (format ?? getFileFormat(urlString)) {
        case 'commonjs':
        case 'commonjs-typescript':
            return 'commonjs';

        default:
            return 'module';
    }
}

function transformFile(urlString: string, options: TransformOptions): string {
    const filePath = fileUrlToPath(urlString);
    // Yarn PnP patches fs to read files inside zip archives as well
    const source = fs.readFileSync(filePath, 'utf8');

    const { code, map, errors } = loadOxc().transformSync(
        filePath,
        source,
        options
    );
    if (errors.length > 0) {
        throw createTransformError(errors);
    }

    return map ? appendSourceMap(code, map, urlString) : code;
}

// oxc reports diagnostics instead of throwing; fail the load as a syntax error would
function createTransformError(errors: OxcError[]): SyntaxError {
    const message = errors
        .map(error => error.codeframe ?? error.message)
        .join('\n');

    return new SyntaxError(message);
}

/**
 * Maps the output back to the source, since oxc prints the code anew. Node
 * resolves `sources` against the module's URL, where a Windows drive letter
 * would read as a URL scheme, so the source is named by its URL.
 */
function appendSourceMap(
    code: string,
    map: NonNullable<TransformResult['map']>,
    urlString: string
): string {
    const json = JSON.stringify({ ...map, sources: [urlString] });
    const encoded = Buffer.from(json).toString('base64');

    return `${code}\n//# sourceMappingURL=data:application/json;base64,${encoded}\n`;
}

let oxc: typeof import('oxc-transform') | undefined;

/**
 * Loads oxc on the first TypeScript file, through `require` so that Yarn
 * PnP's CommonJS resolution finds it without an ES module loader.
 */
function loadOxc(): typeof import('oxc-transform') {
    if (oxc) {
        return oxc;
    }

    const require = createRequire(import.meta.url);
    oxc = require('oxc-transform') as typeof import('oxc-transform');

    return oxc;
}
