# @snovader/tsconfig

Shared TypeScript configurations, tested with TypeScript 7.0.2.

```sh
npm install --save-dev typescript @snovader/tsconfig
```

```json
{
    "extends": "@snovader/tsconfig/node",
    "compilerOptions": {
        "rootDir": "./source",
        "outDir": "./dist"
    },
    "include": ["source/**/*.ts"]
}
```

## Presets

Extend a preset by its package subpath:

| Subpath                                      | File                                    | Environment                                                                  |
| -------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------- |
| `@snovader/tsconfig/base`                    | `tsconfig.base.json`                    | ESNext, NodeNext modules/resolution, strict checking, explicit ambient types |
| `@snovader/tsconfig/node`                    | `tsconfig.node.json`                    | Base plus Node ambient types                                                 |
| `@snovader/tsconfig/isomorphic`              | `tsconfig.isomorphic.json`              | Base plus WebWorker libraries, without DOM globals                           |
| `@snovader/tsconfig/web`                     | `tsconfig.web.json`                     | Base plus DOM libraries                                                      |
| `@snovader/tsconfig/web-preact`              | `tsconfig.web-preact.json`              | Web plus Preact JSX transform                                                |
| `@snovader/tsconfig/cloudflare-workers`      | `tsconfig.cloudflare-workers.json`      | Base plus Cloudflare Worker ambient types                                    |
| `@snovader/tsconfig/cloudflare-workers/test` | `tsconfig.cloudflare-workers-test.json` | Workers plus Cloudflare Vitest plugin types                                  |

The package `exports` only these subpaths. Package paths to the files, such as
`@snovader/tsconfig/tsconfig.node.json`, do not resolve. The file names matter
only for a copied configuration (see
[Yarn Plug'n'Play](#yarn-plugnplay-with-native-typescript-7)).

All presets inherit the base. It enables `composite`, declaration-only emit,
TypeScript import extensions, isolated modules, verbatim module syntax,
unused-local and unused-parameter checks, and implicit-override checks. It sets
`types: []` so unrelated installed ambient types do not leak into the project.

The base also turns these warnings into errors:

| Option                             | Effect                                                           |
| ---------------------------------- | ---------------------------------------------------------------- |
| `allowUnreachableCode: false`      | Unreachable code is an error, not an editor suggestion           |
| `allowUnusedLabels: false`         | Unused labels are an error, not an editor suggestion             |
| `noFallthroughCasesInSwitch: true` | A non-empty `switch` case must not fall through to the next case |
| `erasableSyntaxOnly: true`         | TypeScript-only syntax with runtime behavior is an error         |

`erasableSyntaxOnly` rejects `enum` declarations, namespaces and modules with
runtime code, parameter properties, `import =` and `export =` assignments, and
angle-bracket type assertions such as `<number>value`. The remaining syntax can
be stripped without transformation, as Node.js type stripping does. To use those constructs, turn it off locally:

```json
{
    "extends": "@snovader/tsconfig/node",
    "compilerOptions": {
        "erasableSyntaxOnly": false
    }
}
```

Set `allowUnreachableCode` or `allowUnusedLabels` to `null` to return to
TypeScript's default, which reports them as editor suggestions, or to `true` to
stop reporting them. Set `noFallthroughCasesInSwitch` to `false` to allow
fallthrough.

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

The shared base does not choose JSX behavior outside the Preact preset or
application-specific module conditions. Set these locally when needed.

To apply the same local options to several presets, put them in a file of their
own and list it after the preset:

```json
{
    "extends": ["@snovader/tsconfig/node", "./tsconfig.local.json"]
}
```

Later entries win, so the local file overrides the preset wherever both set an
option, including `types`, `lib`, and `jsx`. Do not give that file an `extends`
of its own: it would apply the base's `types: []` again over the preset's.

## Yarn Plug'n'Play with native TypeScript 7

Stock TypeScript 7.0.2 does not resolve this package through Yarn PnP, with or
without the subpaths. For a configuration on disk, materialize it after
installation:

```sh
yarn unplug @snovader/tsconfig
yarn node -e "require('node:fs').cpSync(require('node:path').dirname(require.resolve('@snovader/tsconfig/base')), '.cache/tsconfig', { recursive: true })"
```

Then extend `./.cache/tsconfig/tsconfig.base.json` or another preset's file
from the table above, adjusting the relative path for nested configs. Run the
copy after package updates and ignore `.cache/` in Git. This only makes the
configuration available: resolving other PnP dependencies still depends on the
compiler used by the consumer. A compiler build with PnP support can extend the
subpaths directly; check with `tsc --showConfig` before adding the copy, and
confirm that the output includes the inherited options, since TypeScript 7.0.2
prints an empty configuration instead of failing when `extends` does not
resolve.

## License

MIT.
