# Tooling conventions

- Use Yarn 4 through the checked-in release. Run `yarn check` before committing.
- Keep the two packages independently versioned and publishable without a build.
- Keep project paths, generated-file exclusions, application imports, ambient
  application typings, and custom module conditions in consuming repositories.
- Preserve the custom rules' observable diagnostics and fixes. Test rules through
  the packed npm package, including valid examples and regression cases.
- Follow the repository's Biome settings: four spaces, single quotes, semicolons,
  and no trailing commas. Keep dependencies limited to development tooling;
  published packages contain configuration and GritQL files only.
- Do not publish to npm as part of ordinary checks or on a push to main.
