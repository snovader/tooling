# Tooling conventions

- Use Yarn 4 through the checked-in release. Run `yarn check` before committing.
- Keep the packages independently versioned. The configuration packages publish
  without a build; `@snovader/node-hooks` compiles its TypeScript to `dist`
  when packed.
- Keep project paths, generated-file exclusions, application imports, ambient
  application typings, and custom module conditions in consuming repositories.
- Preserve the custom rules' observable diagnostics and fixes. Test rules through
  the packed npm package, including valid examples and regression cases.
- Test the module hooks through the packed npm package. Keep the check that a
  large TypeScript module loaded through the hook leaves V8's
  ArrayBufferDetaching protector intact.
- Follow the repository's Biome settings: four spaces, single quotes, semicolons,
  and no trailing commas. Keep dependencies limited to development tooling. The
  configuration packages contain configuration and GritQL files only; the module
  hooks depend on `oxc-transform` alone, with `resolve-pkg-maps` as an optional
  peer.
- Do not publish to npm as part of ordinary checks or on a push to main.
