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

/**
 * Writes a module that reads the file when it's evaluated. The read is
 * synchronous, since a module with a top-level `await` can't be loaded with
 * `require()`. It goes through the default export of `node:fs`, which has
 * what a preloaded script patched in, as Yarn PnP does to read its archives.
 *
 * Node reads a small file into the pool that its buffers share. The module
 * copies those bytes, so that the array's buffer holds the file and nothing
 * else. A larger file's buffer is the array's, without a copy.
 */
function createWrapperModule(urlString: string): string {
    const filePath = fileUrlToPath(urlString);

    return `
        import fs from 'node:fs';
        const nodeBuffer = fs.readFileSync(${JSON.stringify(filePath)});
        const ownsBuffer = nodeBuffer.byteLength === nodeBuffer.buffer.byteLength;
        export default new Uint8Array(ownsBuffer ? nodeBuffer.buffer : nodeBuffer);
    `;
}
