# snovader tooling

Shared development tooling, published as independently versioned npm
packages. The Biome and TypeScript configurations contain only configuration
and GritQL files, with nothing to build. The Node.js module hooks are compiled
to JavaScript when packed.

| Package                                         | Contents                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| [@snovader/biome-config](packages/biome-config) | Formatting, lint settings, and two custom GritQL rules             |
| [@snovader/tsconfig](packages/tsconfig)         | Strict compiler settings with environment presets                  |
| [@snovader/node-hooks](packages/node-hooks)     | TypeScript stripping with oxc, byte imports, and Yarn PnP for Node |

## Usage

Install the packages you need alongside their tools:

```sh
npm install --save-dev @biomejs/biome @snovader/biome-config
npm install --save-dev typescript @snovader/tsconfig
```

Extend them from `biome.json`:

```json
{
    "extends": ["@snovader/biome-config/configs/base"]
}
```

And from `tsconfig.json`:

```json
{
    "extends": "@snovader/tsconfig/tsconfig.node.json",
    "compilerOptions": {
        "rootDir": "./source",
        "outDir": "./dist"
    },
    "include": ["source"]
}
```

Start Node with the TypeScript hook, which strips types without detaching
array buffers as Node's own stripping does:

```sh
npm install @snovader/node-hooks
node --no-strip-types --import @snovader/node-hooks/register app.ts
```

The package READMEs list every preset, rule, and hook.

## What stays local

The shared files hold settings that suit any project. Keep these in the
consuming repository:

- File selection, generated-code exclusions, and VCS settings
- Project paths such as `include`, `rootDir`, `outDir`, and `references`
- Custom module conditions, `erasableSyntaxOnly`, and other project choices
- Ambient typings for the application
- Rule exceptions and restricted imports specific to the application

Biome adds local rules and overrides to the shared ones. TypeScript replaces
inherited arrays such as `types` and `lib`, so list every entry you need.

## Yarn Plug'n'Play

Biome 2.6.4 and TypeScript 7.0.2 cannot load a shared config from a PnP
install. Each package README has a short step that copies the installed config
into `.cache/` for the project to extend. A compiler build with PnP support can
extend the TypeScript presets directly.

## Development

Use Node.js 26 or later and the checked-in Yarn release:

```sh
yarn install --immutable
yarn check
```

If `yarn` is missing or runs another version, use
`node .yarn/releases/yarn-4.18.1.cjs` instead.

`yarn check` runs Biome on this repository and builds the module hooks. It
then packs the packages and installs the tarballs in temporary npm and Yarn
PnP projects. The tests cover:

- formatting, and rule diagnostics and fixes;
- TypeScript inheritance and compilation;
- modules loaded through the hooks, including a check that V8's
  ArrayBufferDetaching protector stays intact.

## Releasing

Release each package separately by changing its own `version`. A stricter rule
or compiler setting can break consumers, so release it as a breaking change.

```sh
yarn check
npm pack --dry-run ./packages/biome-config
npm pack --dry-run ./packages/tsconfig
yarn workspace @snovader/node-hooks pack --dry-run
```

Pack and publish the module hooks with Yarn, which builds them first through
their `prepack` script. In this repository, their `exports` name the
TypeScript source, and Yarn replaces them with those of `publishConfig`, which
name the build. npm keeps the source's exports, which the package leaves out,
so the `prepack` script refuses to run under npm.

After reviewing the contents, publish from an npm account with access to the
`@snovader` scope:

```sh
npm publish ./packages/biome-config
npm publish ./packages/tsconfig
yarn workspace @snovader/node-hooks npm publish
```

Publishing may ask for a two-factor code. CI only runs checks; pushing never
publishes.

## License

MIT
