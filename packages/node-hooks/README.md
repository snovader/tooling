# @snovader/node-hooks

Synchronous Node.js module hooks for `module.registerHooks`:

- strip TypeScript's types with oxc instead of Node's own stripping;
- import a file's bytes;
- cache resolutions;
- resolve Yarn Plug'n'Play packages.

```sh
npm install @snovader/node-hooks
```

Requires Node.js 24.12 or later. Earlier releases of Node 24 have no
`--no-strip-types`, and before 24.6 Node passes the hooks no array of
conditions for a `require()`, which the cache and PnP hooks read.

## Why

Node strips types with amaro, which is swc compiled to WebAssembly. Its memory
grows for a file larger than about 1.2–1.7 KB, and growing it detaches an
`ArrayBuffer`. Detaching any buffer invalidates V8's ArrayBufferDetaching
protector for the rest of the process. From then on, optimized code checks
every typed-array access for a detached buffer. This happens in Node 24.12,
Node 26.13, and Node 27.0.0-alpha alike.

The TypeScript hook strips types with oxc's native transform instead, which
detaches nothing. The package itself is compiled JavaScript, so registering
it strips nothing either. In benchmarks of a binary-format reader run from
source:

- the reader's primitive getters took 0.65× as long in Node 26 and 0.62× in
  Node 27;
- its typed-array getters and setters took about 0.9× as long.

To see whether a process has lost the protector, run it with
`node --trace-protector-invalidation`. Node's own stripping of a large module
prints `Invalidating protector cell ArrayBufferDetaching`.

## TypeScript

Register the hook when Node starts:

```sh
node --no-strip-types --import @snovader/node-hooks/register app.ts
```

The hook strips the types of `.ts`, `.mts`, and `.cts` files with
`file:` URLs:

- `.mts` files load as ES modules and `.cts` files as CommonJS.
- `.ts` files follow their package's `type`.
- A `.ts` file in a package without a `type` loads as an ES module.
- Imports keep the names that aren't marked as types, as Node's stripping
  does (`onlyRemoveTypeImports`).
- Syntax that this version of Node supports stays as it is.
- Invalid syntax fails the import with a `SyntaxError` and oxc's code frame.

`--no-strip-types` keeps Node from stripping types itself, which it otherwise
does a second time for CommonJS that an ES module imports (see
[Limitations](#limitations)).

To compose the hook with others, or to compile `.tsx` files, import it from
`@snovader/node-hooks/typescript`:

```js
import { registerHooks } from 'node:module';
import { createLoadHook, load } from '@snovader/node-hooks/typescript';

// Only .ts, .mts, and .cts files
registerHooks({ load });

// .tsx files too, with options of oxc's JSX transform
registerHooks({ load: createLoadHook({ jsx: { importSource: 'preact' } }) });
```

Without JSX options, `.tsx` files go to the next hook, and Node doesn't load
them.

### Differences from Node's stripping

- oxc prints the code anew, so lines and columns in stack traces shift. With
  `--enable-source-maps`, or `process.setSourceMapsEnabled(true)`, the hook
  adds an inline source map, and stack traces show the TypeScript positions.
- oxc also compiles syntax that Node's stripping rejects, such as enums,
  namespaces, and parameter properties.
- Files inside `node_modules` load as well, where Node refuses to strip them.
- Node detects the syntax of a `.ts` file in a package without a `type`;
  the hook loads it as an ES module.
- Neither checks types.

## Bytes

`@snovader/node-hooks/bytes` loads a file imported with the `bytes` type as
a module whose default export is a `Uint8Array` of the file's contents:

```js
import { registerHooks } from 'node:module';
import { load } from '@snovader/node-hooks/bytes';

registerHooks({ load });
```

```js
import bytes from './image.png' with { type: 'bytes' };
```

The module reads the file when it's evaluated. Unlike the TC39 Import Bytes
proposal, the bytes aren't immutable.

## Resolution cache

`@snovader/node-hooks/cache` remembers each resolution for the rest of the
process, by specifier, importing directory, and conditions:

- A resolution stays as it was, even if files change later.
- Import attributes aren't part of the key.
- Built-in modules resolve without the hooks after it.

Register it last, so that it runs first.

## Yarn Plug'n'Play

`@snovader/node-hooks/pnp` resolves packages through Yarn PnP's API, without
Yarn's ES module loader:

- Packages resolve through their `exports`, and subpath imports through the
  `imports` of the importing package.
- Outside an ES module package, a path without an extension tries `.js`,
  `.ts`, `.json`, and `index` files.
- Files are read through `fs`, which Yarn's runtime patches to read its zip
  archives.

It needs:

- Yarn's runtime, loaded with `--require ./.pnp.cjs`;
- the optional peer dependency `resolve-pkg-maps`.

Without Yarn's ES module loader, Node can't resolve this package by name from
an ES module, nor import files from Yarn's archives. Resolve the package
through `require`, which Yarn's runtime patches, and unplug it in
`package.json`, so that its files are on disk:

```json
{
    "dependenciesMeta": {
        "@snovader/node-hooks": { "unplugged": true }
    }
}
```

```js
// register.mjs
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const importHooks = name =>
    import(pathToFileURL(require.resolve(`@snovader/node-hooks/${name}`)).href);

const pnp = await importHooks('pnp');
const typescript = await importHooks('typescript');
const bytes = await importHooks('bytes');
const cache = await importHooks('cache');

// Node runs the hooks registered last first
registerHooks({ resolve: pnp.resolve, load: pnp.load });
registerHooks({ load: typescript.load });
registerHooks({ load: bytes.load });
registerHooks({ resolve: cache.resolve });
```

```sh
node --require ./.pnp.cjs --import ./register.mjs app.ts
```

## Limitations

- When an ES module imports CommonJS TypeScript, Node 26 and 27 strip the
  hook's output again with amaro, which detaches a buffer for a large file.
  This applies to `.cts` files, and to `.ts` files in a `commonjs` package.
  `require()` doesn't do this, and `--no-strip-types` prevents it.
- The hook depends on oxc's native binding, which `oxc-transform` installs
  for common platforms. oxc's WebAssembly fallback hasn't been checked for
  detached buffers.
- Windows paths, on drives and on UNC shares (`\\server\share`), have been
  tested only by simulating Windows on Linux and macOS, not on Windows.
