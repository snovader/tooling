# @snovader/oxc-config

Shared configuration for oxfmt 0.79 and oxlint 1.94, with presets for
Vitest, hypotes and Preact, and a plugin with a rule that sorts the names
of imports.

```sh
yarn add --dev @snovader/oxc-config oxfmt oxlint oxlint-tsgolint
```

The base configuration runs oxlint's type-aware rules, which need
`oxlint-tsgolint` and a `tsconfig.json`.

## oxfmt

oxfmt has no `extends`, so spread the configuration into the project's
`oxfmt.config.ts`, and add the paths that it ignores and the names that it
imports itself by:

```ts
import oxfmt from '@snovader/oxc-config/oxfmt';
import { defineConfig } from 'oxfmt';

export default defineConfig({
    ...oxfmt,
    ignorePatterns: ['.yarn', 'dist', '**/package.json', '**/*.md'],
    sortImports: { ...oxfmt.sortImports, internalPattern: ['my-package'] }
});
```

It indents by four spaces, with single quotes, semicolons, no trailing commas,
parentheses around arrow functions' parameters only where needed, and double
quotes in JSX. Lines wrap at 80 columns, tests (`*.test.ts` and `*.test.tsx`)
at 100, and TypeScript configurations at 60. YAML indents by two spaces, with
double quotes. Imports are sorted: Node's modules, other packages, the
project's packages by the names that they export, then by their private paths,
then relative paths, nearest last. Add `overrides` after `...oxfmt.overrides`
to keep the shared ones.

## oxlint

Extend the base, and the presets that the project needs, from the project's
`oxlint.config.ts`:

```ts
import oxlint from '@snovader/oxc-config/oxlint';
import preact from '@snovader/oxc-config/oxlint/preact';
import vitest from '@snovader/oxc-config/oxlint/vitest';
import { defineConfig } from 'oxlint';

export default defineConfig({
    extends: [oxlint, vitest, preact],
    ignorePatterns: ['.yarn', 'dist']
});
```

oxlint merges extended configurations in order, joining their plugins and
overrides. The project's own `rules` and `overrides` come last.

- `oxlint`: every rule of the correctness, suspicious, pedantic and perf
  categories of the eslint, typescript, unicorn, oxc, import, jsdoc and promise
  plugins, with type-aware rules and unused disable directives reported, and
  a selection of style and restriction rules. The rules that TypeScript
  reports itself are off, and so are those that limit length or require
  JSDoc tags for every parameter. Files are named in kebab-case, whatever
  they export, so that an import path reads the same on file systems that
  ignore case: a project with other names renames its files, or turns
  `unicorn/filename-case` off for them. Each setting has a comment that says
  why.
  Configuration files (`*.config.ts`) may export defaults, tests may allocate
  arrays of holes and pass callbacks that return values where nothing is
  returned, and JavaScript files don't need `readonly`.
- `oxlint/vitest`: oxlint's rules for tests that import from `vitest`, where
  helpers whose names start with `expect` count as assertions.
- `oxlint/hypotes`: hypotes' rules for tests that import from `hypotes`, from
  the plugin that it publishes. Install `hypotes` 0.1.
- `oxlint/preact`: the rules of hooks, exhaustive dependencies, keys in lists,
  and self-closing elements, with the react plugin's other rules of the base's
  categories. `react-in-jsx-scope` is off, as the compiler imports Preact's
  JSX runtime, and so is `immutability`, which takes a write to a signal's
  `.value` for a change to what a hook returned.

Keep ignored paths, restricted imports, and the rules that a project turns
off for reasons of its own in the project's configuration.

### Signals and exhaustive dependencies

oxlint's `react/exhaustive-deps` takes only `additionalHooks`, and has no way
to mark a hook's result as stable. It reports a signal from `useSignal` or
`useComputed` that a callback, effect or memo reads but doesn't list. List
the signal itself, which stays the same from one render to the next, rather
than its `.value`, which would subscribe the component to it:

```tsx
const url = useSignal('/');
const route = useCallback(
    (next: string): void => {
        url.value = next;
    },
    [url]
);
```

## sort-named-imports

The base loads the package's plugin and turns on `snovader/sort-named-imports`,
which orders the names in an import's braces: functions and values whose names
start in lower case, then classes and constants, then names that start
otherwise, such as with `_`, then types, each in natural order, so `SIZEOF_8`
comes before `SIZEOF_16`. Its fix moves the names, unless comments lie between
them.

## Array types and return types

`typescript/array-type` uses `T[]` and `readonly T[]` for arrays of keywords,
of names without type arguments, and of arrays of those, and `Array<T>` and
`ReadonlyArray<T>` for the rest: `number[][]` and `readonly string[]`, but
`Array<string | number>`. Its fix rewrites the type.

`typescript/explicit-function-return-type` requires return types on function
declarations, class members, overrides included, and functions bound to
variables. It doesn't require them on callbacks, on functions whose type
comes from where they appear, such as a typed variable, on the members of an
object literal without a type, or in JavaScript files.

## Yarn Plug'n'Play

oxlint and oxfmt import the configurations through Yarn PnP. oxlint can't load
a plugin from Yarn's zip archives, so the base names the plugin by its path in
the installed package, and the package asks Yarn to unpack it with
`preferUnplugged`. hypotes doesn't, so a project that extends `oxlint/hypotes`
unplugs it:

```json
{
    "dependenciesMeta": {
        "hypotes": { "unplugged": true }
    }
}
```

tsgolint can't resolve packages through PnP, so the type-aware rules see what
a module imports from a package as an error type.

## License

MIT
