# @snovader/biome-config

Shared formatting and lint configuration for Biome 2.6.4 or later in the 2.x
series, including two GritQL rules.

```sh
npm install --save-dev @biomejs/biome @snovader/biome-config
```

In `biome.json` or `biome.jsonc`:

```json
{
    "extends": ["@snovader/biome-config/configs/base"]
}
```

## Configurations

- `configs/base`: four-space indentation, single quotes, semicolons, no trailing
  commas, an 80-column default, selected lint rules, and both custom rules.
  Test files (`*.test.ts` and `*.test.tsx`) use 100 columns; TypeScript configs
  use 60 columns. Assist actions are disabled.
- `configs/preact`: the base plus JSX key and self-closing checks, hook checks,
  and stable-result recognition for `useSignal` and `useComputed`.

Configuration plugins resolve relative to the declaring config, so consumers
need neither copied `.grit` files nor hardcoded `node_modules` paths. Keep file
selection, VCS settings, application-specific exceptions, and generated-code
exclusions in the consuming repository.

## Rules without the shared formatting

Enable both rules using a preset:

```json
{
    "plugins": ["@snovader/biome-config/presets/recommended"]
}
```

Or enable either rule individually:

```json
{
    "plugins": [
        "@snovader/biome-config/useArraySimple",
        "@snovader/biome-config/useExplicitReturnType"
    ]
}
```

The shared configurations already enable both rules; do not add them again.

### useArraySimple

Use `T[]` and `readonly T[]` for simple element types: keywords, names without
type arguments, and arrays of those types. Use `Array<T>` or `ReadonlyArray<T>`
for other element types. Examples: `number[][]`, `Buffer[]`,
`Array<Span<Date>>`, and `Array<[key: string, value: number]>`. Heritage clauses
remain generic. The rule provides fixes, which Biome classifies as unsafe; apply them with
`biome lint --write --unsafe` after review.

This replaces Biome's `useConsistentArrayType`, which cannot express this
simple-versus-complex distinction.

### useExplicitReturnType

Require return annotations on TypeScript function declarations, class methods
and getters, and functions assigned to variables or object properties. Exempt
inline callbacks, overrides, contextually typed objects and expressions, and
self-typed arrow functions returning a const assertion or another function.
JavaScript files are exempt.

This replaces Biome's built-in `useExplicitReturnType` where its contextual
exemptions differ. Do not enable both versions of either replacement rule.

## Yarn Plug'n'Play

Biome 2.6.4 cannot resolve the package specifier through Yarn PnP. Keep PnP and
materialize the installed package to a stable cache path instead:

```sh
yarn unplug @snovader/biome-config
yarn node --conditions=biome -e "require('node:fs').cpSync(require('node:path').dirname(require.resolve('@snovader/biome-config')), '.cache/biome-config', { recursive: true })"
```

Then extend the materialized file:

```json
{
    "extends": ["./.cache/biome-config/configs/preact.json"],
    "files": {
        "includes": ["**", "!.cache", "!.yarn", "!.pnp.*"]
    }
}
```

Use `base.json` instead for projects without Preact. Run the materialization
command after installation and package updates, for example in a consumer's
`postinstall` script. Ignore `.cache/` in Git. This cache is generated from the
installed npm version; its contents are not a second maintained copy of the
rules. Neither `yarn unplug` alone nor disabling PnP inlining makes Biome's
package-specifier resolution work.

## License

MIT.
