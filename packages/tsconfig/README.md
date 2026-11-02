# @snovader/tsconfig

Shared TypeScript configurations, tested with TypeScript 7.0.2.

```sh
npm install --save-dev typescript @snovader/tsconfig
```

```json
{
    "extends": "@snovader/tsconfig/tsconfig.node.json",
    "compilerOptions": {
        "rootDir": "./source",
        "outDir": "./dist"
    },
    "include": ["source/**/*.ts"]
}
```

## Presets

| File                                    | Environment                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| `tsconfig.base.json`                    | ESNext, NodeNext modules/resolution, strict checking, explicit ambient types |
| `tsconfig.node.json`                    | Base plus Node ambient types                                                 |
| `tsconfig.isomorphic.json`              | Base plus WebWorker libraries, without DOM globals                           |
| `tsconfig.web.json`                     | Base plus DOM libraries                                                      |
| `tsconfig.web-preact.json`              | Web plus Preact JSX transform                                                |
| `tsconfig.cloudflare-workers.json`      | Base plus Cloudflare Worker ambient types                                    |
| `tsconfig.cloudflare-workers-test.json` | Workers plus Cloudflare Vitest plugin types                                  |

All presets inherit the base. It enables `composite`, declaration-only emit,
TypeScript import extensions, isolated modules, verbatim module syntax,
unused-local and unused-parameter checks, and implicit-override checks. It sets
`types: []` so unrelated installed ambient types do not leak into the project.

The compiler target and libraries use ESNext. Libraries intended for older
runtimes should select an explicit distribution target in their build config.
For JavaScript emit, set `emitDeclarationOnly: false` and, when using `.ts`
import extensions, `rewriteRelativeImportExtensions: true`.

Install the environment dependencies used by your selected preset:

- Node: `@types/node`.
- Preact: `preact`.
- Cloudflare Workers: `@cloudflare/workers-types`.
- Cloudflare Worker tests: additionally `@cloudflare/vitest-plugin`.

These are consumer dependencies, not dependencies of this config package.

## Local settings

Declare `include`, `exclude`, `files`, `references`, `rootDir`, `outDir`,
`tsBuildInfoFile`, module conditions, and application typings in the consuming
repository. Relative paths are resolved from the config that declares them.
`types` and other arrays replace inherited arrays rather than appending.

The shared base does not choose `erasableSyntaxOnly`, JSX behavior outside the
Preact preset, or application-specific module conditions. Set these locally when
needed.

## Yarn Plug'n'Play with native TypeScript 7

Stock TypeScript 7.0.2 does not resolve this package through Yarn PnP. For a
configuration on disk, materialize it after installation:

```sh
yarn unplug @snovader/tsconfig
yarn node -e "require('node:fs').cpSync(require('node:path').dirname(require.resolve('@snovader/tsconfig/tsconfig.base.json')), '.cache/tsconfig', { recursive: true })"
```

Then extend `./.cache/tsconfig/tsconfig.base.json` or another preset, adjusting
the relative path for nested configs. Run the copy after package updates and
ignore `.cache/` in Git. This only makes the configuration available: resolving
other PnP dependencies still depends on the compiler used by the consumer.
Custom compiler builds may have different PnP support.

## License

MIT.
