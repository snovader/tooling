// Stops any package manager but Yarn from packing the package, as `prepack`
// runs this before the build. In this repository, the exports of package.json
// name the source, which the package leaves out, and those of `publishConfig`
// name the build. Yarn packs the package with the latter, and npm with the
// former, so a package that npm packed or published couldn't be imported.

/** What the package manager that runs a script calls itself */
const userAgent = process.env.npm_config_user_agent ?? '';

if (!userAgent.startsWith('yarn/')) {
    console.error(
        'Pack and publish @snovader/oxc-config with Yarn, as `yarn pack` or ' +
            '`yarn npm publish`, which replace the exports of package.json ' +
            "with those of its publishConfig. npm keeps the source's " +
            'exports, which the package leaves out.'
    );
    process.exitCode = 1;
}
