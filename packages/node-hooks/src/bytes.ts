import type { LoadHookSync } from 'node:module';
import { fileUrlToPath, isFileUrl } from './internal/url.ts';

/**
 * Loads a file imported `with { type: 'bytes' }` as a module whose default
 * export is a `Uint8Array` of the file's contents.
 */
export const load: LoadHookSync = (urlString, context, nextLoad) => {
    if (context.importAttributes?.type !== 'bytes') {
        return nextLoad(urlString, context);
    }

    if (!isFileUrl(urlString)) {
        return nextLoad(urlString, context);
    }

    return {
        format: 'module',
        source: createWrapperModule(urlString),
        shortCircuit: true
    };
};

function createWrapperModule(urlString: string): string {
    const filePath = fileUrlToPath(urlString);

    return `
        import { readFile } from 'node:fs/promises';
        const nodeBuffer = await readFile(${JSON.stringify(filePath)});
        const bytes = new Uint8Array(nodeBuffer.buffer, nodeBuffer.byteOffset, nodeBuffer.byteLength);
        export default bytes;
    `;
}
