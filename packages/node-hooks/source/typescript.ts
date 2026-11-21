import {
    createRequire,
    type LoadHookSync,
    type ModuleSource
} from 'node:module';
import process from 'node:process';
import type { JsxOptions, OxcError, TransformOptions } from 'oxc-transform';
import type * as OxcTransform from 'oxc-transform';
import { getFileFormat } from './internal/packages.ts';
import {
    appendSourceMap,
    remapSourceMap,
    splitInlineSourceMap
} from './internal/source-map.ts';
import { extnameFromUrl, fileUrlToPath, isFileUrl } from './internal/url.ts';

export interface TypeScriptHookOptions {
    /**
     * Compiles `.tsx` files with these options of oxc's JSX transform, such as
     * `{ importSource: 'preact' }`. Without them, `.tsx` files go to the next
     * hook, as Node doesn't load them.
     */
    jsx?: JsxOptions;
}

type TypeScriptFormat = 'commonjs-typescript' | 'module-typescript';

type SourceType = 'commonjs' | 'module';

/** Leaves the syntax that this version of Node runs as it is */
const target = `node${process.versions.node}`;

const decoder = new TextDecoder();

/**
 * Creates a load hook that strips the types of `.ts`, `.mts`, and `.cts`
 * files with oxc, and compiles `.tsx` files when given JSX options. It
 * strips the source that the hooks after it load, so that they can read or
 * replace it, and leaves what they load as JavaScript as it is.
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

        // Without a TypeScript format, Node's own load rejects the file
        // under --no-strip-types
        const loaded = nextLoad(urlString, {
            ...context,
            format: typeScriptFormat(urlString, context.format)
        });

        const sourceType = sourceTypeOf(loaded.format);
        if (!sourceType || loaded.source === undefined) {
            return loaded;
        }

        return {
            ...loaded,
            format: sourceType,
            source: transformSource(urlString, decode(loaded.source), {
                lang,
                sourceType,
                target,
                typescript: { onlyRemoveTypeImports: true },
                jsx
            })
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
            return undefined;
    }
}

/**
 * The TypeScript format to load the file as, from the format that
 * resolution gave it, which Node's resolver sets for a file with a package
 * type or a `.mts` or `.cts` extension, and the package type otherwise
 */
function typeScriptFormat(
    urlString: string,
    format: string | null | undefined
): TypeScriptFormat {
    switch (format ?? getFileFormat(urlString)) {
        case 'commonjs':
        case 'commonjs-typescript':
            return 'commonjs-typescript';

        default:
            return 'module-typescript';
    }
}

/** The source type of what a hook loaded, if it's TypeScript */
function sourceTypeOf(
    format: string | null | undefined
): SourceType | undefined {
    switch (format) {
        case 'commonjs-typescript':
            return 'commonjs';

        case 'module-typescript':
            return 'module';

        default:
            return undefined;
    }
}

function decode(source: ModuleSource): string {
    return typeof source === 'string' ? source : decoder.decode(source);
}

/**
 * Strips the source's types, and maps the output back to the source. Where
 * a hook after this one appended a source map, the output maps through it,
 * since Node reads only the last.
 */
function transformSource(
    urlString: string,
    source: string,
    options: TransformOptions
): string {
    const { code: input, map: inputMap } = splitInlineSourceMap(source);

    const { code, map, errors } = loadOxc().transformSync(
        fileUrlToPath(urlString),
        input,
        {
            ...options,
            sourcemap: process.sourceMapsEnabled || inputMap != null
        }
    );
    if (errors.length > 0) {
        throw createTransformError(errors);
    }

    if (!map) {
        return code;
    }

    // oxc prints the code anew. Node resolves `sources` against the module's
    // URL, where a Windows drive letter would read as a URL scheme, so the
    // source is named by its URL.
    return appendSourceMap(
        code,
        inputMap
            ? remapSourceMap(map, inputMap)
            : { ...map, sources: [urlString] }
    );
}

// oxc reports diagnostics instead of throwing; fail the load as a syntax error would
function createTransformError(errors: OxcError[]): SyntaxError {
    const message = errors
        .map(error => error.codeframe ?? error.message)
        .join('\n');

    return new SyntaxError(message);
}

let oxc: typeof OxcTransform | undefined;

/**
 * Loads oxc on the first TypeScript file, through `require` so that Yarn
 * PnP's CommonJS resolution finds it without an ES module loader.
 */
function loadOxc(): typeof OxcTransform {
    if (oxc) {
        return oxc;
    }

    const require = createRequire(import.meta.url);
    oxc = require('oxc-transform') as typeof OxcTransform;

    return oxc;
}
