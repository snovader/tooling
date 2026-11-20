import {
    isBuiltin,
    type ResolveFnOutput,
    type ResolveHookSync
} from 'node:module';
import path from 'node:path/posix';
import { resolveBuiltin } from './internal/packages.ts';

const resolveCache = new Map<string, ResolveFnOutput>();

/**
 * Remembers each resolution for the rest of the process, by specifier, the
 * importing module's directory, and the conditions. Resolves built-in modules
 * without the hooks after it.
 */
export const resolve: ResolveHookSync = (specifier, context, nextResolve) => {
    if (isBuiltin(specifier)) {
        return resolveBuiltin(specifier);
    }

    const { parentURL, conditions } = context;
    const parentDirectory =
        parentURL === undefined || parentURL === ''
            ? parentURL
            : path.dirname(parentURL);
    const cacheKey = `${specifier}|${parentDirectory}|${conditions.join(',')}`;

    // Node 24 has no Map.prototype.getOrInsertComputed
    let resolution = resolveCache.get(cacheKey);
    if (resolution === undefined) {
        resolution = { ...nextResolve(specifier, context), shortCircuit: true };
        resolveCache.set(cacheKey, resolution);
    }

    return resolution;
};
