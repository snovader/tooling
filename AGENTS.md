# Code and design guidelines

These repository guidelines apply when designing, implementing, reviewing, and
refactoring code. Use judgment about tradeoffs; existing code is evidence of
intent, not a requirement to preserve every detail.

## Responsibilities and architecture

- Give each function, class, and module a clear scope of responsibility.
  For example, in `@snovader/oxc-config`, `oxfmt.ts` holds the formatting,
  `oxlint/index.ts` the base rules, `vitest.ts`, `hypotes.ts`, and
  `preact.ts` the rules of their presets, and `oxlint/plugin.ts` the
  package's own rule. In `@snovader/node-hooks`, `typescript.ts` strips
  types, `bytes.ts` loads bytes, `cache.ts` caches resolutions, `pnp.ts`
  resolves through Yarn PnP, and `internal/` holds what they share.
- Search for existing implementations and related abstractions before adding
  code. Always consider reusability and where behavior belongs. Keep a helper
  local when its responsibility is local; share it when it has a coherent role
  across callers.
- Use classes for encapsulated state, identity, lifecycle, or meaningful behavior.
  Use functions for stateless operations. Caches can own mutable state when that
  is part of their purpose.
- Introduce interfaces at meaningful boundaries or useful substitution points.
  Inject dependencies directly through constructors or callbacks. A
  hypothetical future implementation alone needs stronger justification.
- A stable domain-facing API can justify a thin delegating wrapper, provided its
  purpose is clear. Do not remove such a wrapper merely because it delegates.
- Respect package exports. Keep dependencies consistent with the responsibility
  of the package and consider their runtime costs.

## Functions and readability

- Prefer small, focused functions with intentional names. A single caller does
  not prevent extraction: naming a meaningful operation or clarifying its scope
  is sufficient. Avoid arbitrary function-length limits.
- Use whitespace deliberately to separate logical sections within a function,
  such as preparation, computation, side effects, and the result. Keep closely
  related statements together.
- Avoid chained calls with large inline function bodies. Extract substantial
  callbacks into named functions or methods so the overall operation stays easy
  to follow.
- Review adjacent multiline calls and deeply nested expressions for readability.
  Use blank lines between distinct steps and meaningful intermediate variables
  where they clarify the sequence. Preserve efficient execution when restructuring
  expressions; readability does not require extra copies or traversals.
- Use domain terminology consistently. Comments should explain non-obvious
  constraints, algorithms, units, external behavior, or implementation tradeoffs.
  Document public contracts where callers need that information.

## Encapsulation and API design

- Prefer private fields and method-style accessors, especially when access
  performs computation, validation, caching, or other logic. Use `readonly` where
  the field should not be reassigned. This preference can evolve when language
  features offer a compelling improvement.
- Make construction and conversion intentional, using named factories or
  conversion methods where they clarify semantics.
- Make call sites understandable. Use options objects for related configuration.
- Use types to express contracts, including identifiers, units, and supported
  representations where useful. Follow the existing explicit return types and
  type-only imports at API boundaries.
- Decide failure behavior explicitly for each API. Consider possible inputs,
  who calls it, and how its output will be consumed before choosing exceptions,
  missing values, non-finite results, or fallbacks. Document and test that choice.
- Validate external data at appropriate boundaries and establish internal
  invariants deliberately. Avoid silently replacing invalid results with plausible
  values unless that is the intended contract.
- Don't recheck at runtime what documented usage or the types already
  guarantee. Enforce correctness at the boundary that owns it, such as the
  API's contract.

## Shared configuration

- A shared configuration holds what suits any project that extends it: the
  formatting, the rules and their options, the compiler's flags, and presets
  for an environment or a framework. What depends on the project stays in the
  project's configuration, rather than in a package or one of its presets:
  - the paths that the tools ignore, and the files that TypeScript checks,
    with `rootDir`, `outDir`, and `references`;
  - the names that a project imports itself by, which oxfmt's
    `sortImports.internalPattern` takes;
  - restrictions on importing a project's entry points, with
    `no-restricted-imports`;
  - the rules that a project turns off for reasons of its own;
  - ambient typings of an application, and custom module conditions.

  The root README lists these for the packages' users.
- A change that fails a consumer's check where it passed before is a breaking
  change: a new or stricter rule, a stricter compiler flag, or a formatting
  option that changes the output. Release it as one, with a new major
  version, or a new minor version while the major is 0. Raising the range of
  a peer dependency, such as oxlint's, can be one too, since a new version of
  oxlint can add rules to the categories that the base turns on. The base
  runs the rules of the style and restriction categories only where it lists
  them, as its comment says, since most describe another house style, and a
  new version of oxlint adds rules to them.
- Say why beside each setting whose reason isn't obvious, and beside each
  rule that's turned off, as `oxlint/index.ts` does.
- Test the configurations and the plugin through the package as it's
  published. `test/consumers.ts` packs each package with Yarn, which runs its
  `prepack`, and installs the tarball in a temporary project, with npm into
  `node_modules`, and in another with Yarn PnP. The tests run the tools
  there, and check what a consumer sees: oxfmt's output, oxlint's diagnostics
  and fixes, tsc's errors and `tsc --showConfig`'s options, and what Node
  prints of a module that loads through the hooks. Add valid examples as well
  as reported ones, and a regression case for each known failure.
- Where a tool can't do what a setting needs, test the limitation, so that
  the test fails once it's gone: the Preact preset's test of signals that
  hooks leave out, and the test that oxlint can't load the plugin from Yarn's
  zip archive, are such tests. Say what it costs a consumer in the package's
  README.

### In step with benk, hypotes, and tafla

- `@snovader/oxc-config` shares the formatting and lint rules of benk,
  hypotes, and tafla. Each of them keeps a configuration of its own, and none
  extends the package yet.
- The base has the rules that their configurations have in common, with the
  comments that say why, and `unicorn/filename-case`, which benk and hypotes
  turn on, and which tafla's files don't follow yet. A rule that only some of
  them set for reasons of their own stays in theirs, such as
  `import/no-relative-parent-imports`, `no-await-in-loop`, or
  `no-restricted-imports`.
- `oxlint/hypotes` turns on the rules of hypotes' plugin that hypotes and
  tafla turn on, and `oxlint/vitest` the same rules, by oxlint's `vitest`
  names. `snovader/sort-named-imports` is the rule that hypotes and tafla
  have in their own plugins, with the same message and fix.
- When one of them changes a rule that the package shares, compare the three
  configurations again. Change the base or the preset, its comment, and its
  tests in the same change, and release it as the change above says.

## Module hooks

- `@snovader/node-hooks` strips types with oxc because Node's own stripping
  detaches an `ArrayBuffer`, which invalidates V8's ArrayBufferDetaching
  protector for the rest of the process. Keep the tests that a large module
  loaded through the hooks leaves the protector intact, which run Node with
  `--trace-protector-invalidation`.
- The hooks are synchronous, for `module.registerHooks`. Where a hook does
  what Node does, match Node's behavior, and list each difference in the
  README's differences from Node's stripping or limitations.
- The hooks handle Windows paths, on drives and UNC shares, which the tests
  check by simulating Windows on Linux and macOS: a probe sets
  `process.platform` and replaces `fs`. CI has no Windows job, so the README
  says that they haven't run on Windows.

## CPU, memory, and measurement

- Design for CPU and memory efficiency from the outset. Avoid unnecessary copies,
  allocations, loops, conversions, and repeated computation.
- Balance performance against complexity and clarity. When the tradeoff is
  uncertain, run the code, measure representative workloads, and evaluate the
  result. Do not rely solely on intuition about what should be faster.
- For performance changes, compare actual behavior before and after, including
  relevant CPU or memory costs. Preserve correctness and public contracts.
  Report the workload, results, and limitations of the measurement; distinguish
  measured results from expectations.

## Refactoring and language evolution

- Before undertaking a broader refactor discovered during a task, propose it to
  the user. Show concrete evidence of the problem, the proposed design, affected
  scope, benefits, and costs. Wait for a decision before implementing that broader
  change. Routine local structuring within the agreed task can proceed.
- Consider current language and platform capabilities. A built-in may replace
  custom code or a dependency when supported by the project's target runtimes and
  compatible with the required behavior. Preserve the intent of the design while
  evaluating better ways to express it.

## Tests

- Test the public API, not the implementation. Assert what a consumer can
  observe, such as a tool's output and exit code, the options that a
  configuration resolves to, and what a module prints. Do not assert private
  state or which code path ran.
- Each package has a test file of its own in `test/`, which packs it once,
  in a sandbox that it removes after its tests, as
  [Shared configuration](#shared-configuration) describes.
- Use generic shapes in examples and tests, rather than the formats of any one
  application.
- Use meaningful test names and keep grouping shallow. Add `describe` blocks
  when they organize related behavior, rather than repeating the file's identity.
- Run the relevant code and checks, and state anything that could not be run.

## Package and runtime

- The packages support the versions of Node that their `engines` name. CI
  tests Node 26.0.0, the oldest, and the latest Node 26. Use a built-in only
  when every one of them has it.
- Node runs the repository's TypeScript as it is, by stripping its types:
  the tests, the configurations of oxfmt and oxlint, and the source of
  `@snovader/oxc-config`, which they import. So use only erasable syntax,
  which the base's `erasableSyntaxOnly` checks, and import relative modules
  with their `.ts` extensions.
- Name TypeScript and JavaScript files and their folders in kebab-case, as
  `require-yarn.ts`, whatever they export. oxlint checks the files' names.
- `@snovader/oxc-config` and `@snovader/node-hooks` are written in TypeScript
  under `source/`. Their `build` script compiles it to `dist/`, with
  declarations, through `tsconfig.dist.json`, and their `prepack` runs it. In
  this repository, their exports name the source; the published package's, in
  `publishConfig`, name the build. A new entry point goes in both.
- `@snovader/tsconfig` publishes its JSON files as they are. Extend a preset
  by the subpath that `exports` names; a new preset goes in `exports` and in
  the tests' `SUBPATHS`.
- The configuration packages have no dependencies. The tools that they
  configure are optional peer dependencies, which the consumer installs.
  `@snovader/node-hooks` depends only on `oxc-transform`, with
  `resolve-pkg-maps` as an optional peer dependency for its PnP hooks.
  Adding a dependency needs strong justification.

## Documentation

- The root `README.md` is for those who use the packages: what each one is,
  how to start, what stays in a project, and Yarn PnP. Each package's
  `README.md` is published with it, and has its presets, rules, or hooks.
  This file is for those who change the packages. Keep each fact in one of
  them.
- Lead with the common case. The quick start is the shortest path from
  installing a package to a passing check. Introduce what only some projects
  need where they need it, as the presets for Vitest and Preact come after
  the base.
- Give steps in the order that a reader takes them. Name the file that a
  sample goes in, and show a command's output where it tells the reader
  that the step worked.
- Say why, not only what. A reader chooses between a shared setting and one
  of their own, so say what each setting prevents, and what it costs. Don't
  retell the source: describe what a consumer does and sees.
- Write short sentences, one idea in each. Two sentences read better than
  one with a chain of clauses, and a list or a table better than a long
  sentence of alternatives. Use numbered steps for a procedure, and a table
  for what a reader looks up. Leave out emoji, praise of the packages, and
  sections that say nothing a reader needs.
- State only what was checked. Run every sample and command before
  committing it, on the packed package, in a project outside the repository.
  Say in the pull request what was run, and what wasn't.
- A change to what a package exports changes its README in the same change:
  a new preset, rule, hook, or entry point, or a limitation that goes away.
- Link to the documentation of oxfmt, oxlint, TypeScript, and Node for what
  they document, rather than restating it.
- Don't add other documentation files, such as a changelog or a
  contributing guide, unless asked to.
- The repository's oxfmt configuration leaves out Markdown, so wrap prose at
  80 columns by hand, and align the columns of tables.

## Formatting

- Follow the formatter and compiler configurations, which the repository takes
  from its own packages. oxfmt sets four-space indentation, single quotes,
  semicolons, no trailing commas, and contextual line widths, and YAML
  indents by two spaces, with double quotes. It leaves out `package.json`,
  which Yarn writes in a format of its own. Intentional whitespace and
  readable structure still require judgment after automatic formatting.

## Repository commands

- Run the checks from the repository's root: `yarn format:check`,
  `yarn lint:check`, `yarn typecheck`, and `yarn test`, which packs each
  package and runs the tests on the tarballs. `yarn check` runs the four in
  turn, and `yarn format:write` and `yarn lint:write` fix what they can.
  `.github/workflows/ci.yml` runs the same checks in CI, and the tests on
  Node 26.0.0 and the latest Node 26, on Ubuntu and macOS. Its `Checks` job
  passes when every other job passed, and is the check that `main`'s ruleset
  requires of a pull request.
- Use the Yarn release in `.yarn/releases`, which `.yarnrc.yml` names. The
  repository installs into `node_modules`; the tests make their own Yarn PnP
  projects.
- Dependabot updates the dependencies and the actions daily, with oxc's
  packages in one group. `.github/workflows/dependabot.yml` approves its pull
  requests and turns on auto-merge, so that each merges once `Checks` passes.

### Releasing

- A release on GitHub publishes one package. Set `version` in the package's
  `package.json` in a pull request, then publish a release whose tag names
  the package's directory and the version, as `tsconfig/v1.2.3`.
  `.github/workflows/release.yml` checks that the tag names the version,
  runs `ci.yml` on the tag, and publishes the package with
  `yarn npm publish`, through npm's trusted publishing, with provenance. The
  job runs in the `npm` environment, which waits for the owner's approval. A
  release marked as a pre-release goes under npm's `next` tag, and others
  under `latest`. The repository's rules keep `*/v*` tags from being moved or
  deleted, so a release that went wrong takes a new version.
- A trusted publisher is set up in a package's settings on npm, so the owner
  publishes a package's first version by hand. Then the package's trusted
  publisher names this repository, `release.yml`, and the `npm` environment.
- Pack and publish only with Yarn, which replaces the exports with those of
  `publishConfig`. npm keeps the source's, which the package leaves out, so
  the `prepack` of `@snovader/oxc-config` and `@snovader/node-hooks` fails
  under any other package manager, in `scripts/require-yarn.ts`.
  `yarn workspace <name> pack --dry-run` lists the files that a package
  publishes.
- Nothing publishes on a push or in the checks.
