# snovader tooling

Shared configuration and Node module hooks for TypeScript projects, published
under the `@snovader` scope as three packages, each with a version of its own:

| Package                                     | What it has                                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| [@snovader/tsconfig](packages/tsconfig)     | TypeScript 7 configurations for Node, browsers, workers, and Preact           |
| [@snovader/oxc-config](packages/oxc-config) | oxfmt and oxlint configurations, with presets for Vitest, hypotes, and Preact |
| [@snovader/node-hooks](packages/node-hooks) | Node module hooks: TypeScript stripped with oxc, byte imports, and Yarn PnP   |

The configurations hold what suits any project. A project extends them, and
adds its own paths and exceptions. `@snovader/oxc-config` needs Node 26 or
later, and `@snovader/node-hooks` Node 24.12 or later.

## Quick start

### TypeScript

Install the compiler, Node's types, and the configurations:

```sh
npm install --save-dev typescript @types/node @snovader/tsconfig
```

Extend the Node preset in `tsconfig.json`, and list the project's files:

```json
{
    "extends": "@snovader/tsconfig/node",
    "include": ["*.config.ts", "source"]
}
```

`npx tsc` then checks the types, and writes no files. The
[package's README](packages/tsconfig) has the presets for browsers, workers,
and Preact, and how to emit JavaScript or build project references.

### Formatting and linting

Install the configurations with oxfmt, oxlint, and tsgolint, which runs
oxlint's type-aware rules:

```sh
npm install --save-dev @snovader/oxc-config oxfmt oxlint oxlint-tsgolint
```

oxfmt has no `extends`, so `oxfmt.config.ts` spreads the shared options, and
adds the paths that the project leaves out:

```ts
import oxfmt from '@snovader/oxc-config/oxfmt';
import { defineConfig } from 'oxfmt';

export default defineConfig({
    ...oxfmt,
    ignorePatterns: ['dist', '**/package.json', '**/*.md']
});
```

`oxlint.config.ts` extends the base configuration:

```ts
import oxlint from '@snovader/oxc-config/oxlint';
import { defineConfig } from 'oxlint';

export default defineConfig({
    extends: [oxlint],
    ignorePatterns: ['dist']
});
```

Then check the project:

```sh
npx oxfmt --check
npx oxlint
```

oxfmt prints `All matched files use the correct format.`, and oxlint prints
nothing when it finds nothing. The type-aware rules read the project's
`tsconfig.json`. oxlint skips the files that `.gitignore` lists, but not
`node_modules` by itself, so a project without a `.gitignore` adds
`node_modules` to oxlint's `ignorePatterns`.

The [package's README](packages/oxc-config) has the presets for Vitest,
hypotes, and Preact, and what the rules check.

### Module hooks

Install the hooks:

```sh
npm install @snovader/node-hooks
```

Start Node with the TypeScript hook, which strips types with oxc rather than
with Node's own stripping:

```sh
node --no-strip-types --import @snovader/node-hooks/register source/app.ts
```

Node's own stripping detaches an `ArrayBuffer` once a module is large enough.
From then on, V8's optimized code checks every access to a typed array for a
detached buffer, for the rest of the process. The
[package's README](packages/node-hooks) has the measurements, and the hooks
for imports of bytes, a resolution cache, and Yarn PnP.

## What stays local

The shared configurations leave out what depends on the project. Keep these in
the project's own configuration:

- the paths that oxfmt and oxlint ignore (`ignorePatterns`), and the files
  that TypeScript checks (`include`, `exclude`, `files`), with `rootDir`,
  `outDir`, and `references`;
- the names that the project imports itself by, which oxfmt sorts after other
  packages (`sortImports.internalPattern`);
- the imports that it restricts, such as of its own entry points from inside
  its source (`no-restricted-imports`);
- the rules that it turns off for reasons of its own, with a comment that
  says why;
- the ambient typings of its environment and application, its custom module
  conditions, and JSX outside the Preact preset.

Each tool joins the project's settings to the shared ones in its own way:

- oxfmt: the project's keys replace the shared ones. Spread
  `oxfmt.sortImports` or `oxfmt.overrides` into the project's own to keep
  the shared ones.
- oxlint: `extends` merges the configurations in order, and the project's
  own `rules` and `overrides` come last.
- TypeScript: later entries of `extends` win, and an array, such as `types`
  or `lib`, replaces the inherited one rather than adding to it.

## Yarn Plug'n'Play

The tests install each package in a Yarn PnP project, as well as in
`node_modules`. Under PnP:

- oxlint and oxfmt import `@snovader/oxc-config`'s configurations. oxlint
  loads the package's plugin from disk, so the package asks Yarn to unpack it
  (`preferUnplugged`). A project that extends `oxlint/hypotes` unplugs
  `hypotes` itself.
- tsgolint can't resolve packages through PnP. oxlint's type-aware rules see
  what a module imports from a package as an error type, and the `no-unsafe-*`
  rules report where it's used.
- TypeScript 7.0.2 doesn't resolve `@snovader/tsconfig` in `extends`. The
  project copies the presets to `.cache/` after installing, and extends them by
  path.
- Node resolves packages through Yarn's runtime, loaded with
  `--require ./.pnp.cjs`, and the hooks of `@snovader/node-hooks/pnp`. The
  project unplugs `@snovader/node-hooks`, and imports the hooks by path.

Each package's README has the steps.

## Development

Use Node 26 or later, and the Yarn release in `.yarn/releases`:

```sh
yarn install --immutable
yarn check
```

If `yarn` is missing, `node .yarn/releases/yarn-4.18.1.cjs` runs the same
release.

`yarn check` checks the formatting, lints, and checks the types of the
repository, with its own packages' configurations. Then it runs the tests,
which pack each package with Yarn and install it in temporary projects, with
npm into `node_modules` and with Yarn PnP, and run the tools and hooks there.
[`AGENTS.md`](AGENTS.md) has the guidelines for changing the packages, and
the checks that CI runs.

## Releasing

Each package is released on its own, by a release on GitHub whose tag names
the package's directory and its version, as `oxc-config/v0.2.0`.
`.github/workflows/release.yml` checks the tag, runs CI on it, and publishes
the package to npm. [`AGENTS.md`](AGENTS.md#releasing) has the steps.

## License

[MIT](LICENSE)
