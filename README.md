# snovader tooling

Shared development configuration, published as two independently versioned npm
packages. Both packages contain plain configuration or GritQL files; no build
step or application runtime dependency is needed.

| Package                                         | Purpose                                              |
| ----------------------------------------------- | ---------------------------------------------------- |
| [@snovader/biome-config](packages/biome-config) | Biome formatting, lint settings, and custom rules    |
| [@snovader/tsconfig](packages/tsconfig)         | TypeScript compiler settings and environment presets |

## Development

Use Node.js 24 or later and the checked-in Yarn release:

```sh
yarn install --immutable
yarn check
```

If the `yarn` command is unavailable or delegates to a different version, run
`node .yarn/releases/yarn-4.18.1.cjs` in its place.

Tests pack both packages and install their tarballs in a temporary consumer.
They exercise package resolution, formatting, lint diagnostics and fixes, and
TypeScript configuration inheritance and compilation.

## Releases

Each package starts at version 0.1.0 and is released separately. Change a package's
own `version` when releasing it. A stricter rule or compiler setting can break a
consumer, so document such changes and choose the version accordingly.

Before publishing:

```sh
yarn check
npm pack --dry-run ./packages/biome-config
npm pack --dry-run ./packages/tsconfig
```

After reviewing the package contents, sign in as an npm account with access to
`@snovader` and publish the package you want to release:

```sh
npm publish ./packages/biome-config --access public
npm publish ./packages/tsconfig --access public
```

Publishing may prompt for npm two-factor authentication. CI runs checks only;
pushing commits never publishes packages.

## Adopting the packages

Install a published version in each consuming repository, then keep only its
local settings in the configuration that extends the shared preset. Check
formatting, lint, and TypeScript before removing the old configuration and rule
files. Package installation follows the consumer's package manager; the packages
can be installed with npm, Yarn, or pnpm.

For tafla, preserve `customConditions: ["tafla-source"]` and
`erasableSyntaxOnly: true` in its local TypeScript config. Keep its build paths,
project references, generated output, and Biome file selection local.

For Meteox, keep its `@meteox/tsconfig` wrappers if useful for the workspace API.
They can extend these presets while adding `@meteox/typings`, its existing
compiler differences, and local paths. The `types` array replaces the inherited
array, so a Node wrapper needs both `@meteox/typings` and `node`. Use the Biome
Preact preset and retain application-specific exclusions, rule exceptions, and
restricted imports locally. The shared packages contain no Meteox application
code or ambient typings. Meteox uses Yarn PnP: Biome 2.6.4 needs the documented
[materialization step](packages/biome-config/README.md#yarn-plugnplay) to load
its configuration. The PnP integration test checks that recipe and TypeScript
inheritance using materialized config files without changing the consumer's
linker. Stock TypeScript 7 also needs an on-disk config; see its package README
for the equivalent recipe. Meteox uses a custom compiler build, which needs
separate validation during adoption.

## License

MIT. The custom rules and shared base settings originate in snovader's tafla
repository.
