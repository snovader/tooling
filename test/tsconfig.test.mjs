import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
    mkdtempSync,
    mkdirSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = mkdtempSync(join(tmpdir(), 'snovader-tsconfig-'));
const consumer = join(sandbox, 'consumer');
const tsc = join(root, 'node_modules/typescript/bin/tsc');
const yarn = join(root, '.yarn/releases/yarn-4.18.1.cjs');
const presets = {
    base: 'tsconfig.base.json',
    node: 'tsconfig.node.json',
    isomorphic: 'tsconfig.isomorphic.json',
    web: 'tsconfig.web.json',
    'web-preact': 'tsconfig.web-preact.json',
    'cloudflare-workers': 'tsconfig.cloudflare-workers.json',
    'cloudflare-workers/test': 'tsconfig.cloudflare-workers-test.json'
};
let tarball;

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: consumer,
        encoding: 'utf8',
        ...options
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null, result.stderr);
    return result;
}

function succeed(command, args, options = {}) {
    const result = run(command, args, options);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout;
}

function writeJson(path, value) {
    writeFileSync(path, `${JSON.stringify(value, null, 4)}\n`);
}

function configure(extended, compilerOptions = {}, source = 'example.ts') {
    writeJson(join(consumer, 'tsconfig.json'), {
        extends: extended,
        compilerOptions,
        files: [source]
    });
}

// TypeScript 7 prints an empty configuration and exits successfully when
// `extends` does not resolve, so callers assert on the inherited options.
function showConfig(options = {}) {
    return JSON.parse(succeed(process.execPath, [tsc, '--showConfig'], options))
        .compilerOptions;
}

function compile(options = {}) {
    return run(process.execPath, [tsc, '--project', 'tsconfig.json'], options);
}

before(() => {
    mkdirSync(consumer);
    const output = succeed('npm', [
        'pack',
        join(root, 'packages/tsconfig'),
        '--json',
        '--pack-destination',
        sandbox
    ]);
    tarball = join(sandbox, JSON.parse(output)[0].filename);

    writeJson(join(consumer, 'package.json'), {
        private: true,
        type: 'module'
    });
    succeed('npm', [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        tarball
    ]);
    // The consumer supplies its compiler and environment typings.
    symlinkSync(
        join(root, 'node_modules/@types'),
        join(consumer, 'node_modules/@types')
    );
    writeFileSync(
        join(consumer, 'example.ts'),
        'export const answer: number = 42;\n'
    );
});

after(() => rmSync(sandbox, { recursive: true, force: true }));

for (const preset of Object.keys(presets)) {
    test(`packed TypeScript ${preset} subpath resolves and inherits strict checking`, () => {
        configure(`@snovader/tsconfig/${preset}`);
        const config = showConfig();
        assert.equal(config.strict, true);
        assert.equal(config.module, 'nodenext');
        assert.equal(config.emitDeclarationOnly, true);
        assert.equal(config.noImplicitOverride, true);
        assert.equal(config.allowUnreachableCode, false);
        assert.equal(config.allowUnusedLabels, false);
        assert.equal(config.noFallthroughCasesInSwitch, true);
        assert.equal(config.erasableSyntaxOnly, true);
        if (preset === 'base') assert.deepEqual(config.types, []);
        if (preset === 'node') assert.deepEqual(config.types, ['node']);
        if (preset === 'web') assert.ok(config.lib.includes('dom'));
        if (preset === 'isomorphic') {
            assert.ok(config.lib.includes('webworker'));
            assert.ok(!config.lib.includes('dom'));
        }
        if (preset === 'web-preact') {
            assert.ok(config.lib.includes('dom'));
            assert.equal(config.jsx, 'react-jsx');
            assert.equal(config.jsxImportSource, 'preact');
        }
        if (preset === 'cloudflare-workers')
            assert.deepEqual(config.types, ['@cloudflare/workers-types']);
        if (preset === 'cloudflare-workers/test') {
            assert.deepEqual(config.types, [
                '@cloudflare/workers-types',
                '@cloudflare/vitest-plugin/types'
            ]);
        }
    });
}

test('preset file paths are not exported', () => {
    configure('@snovader/tsconfig/tsconfig.base.json');
    const result = compile();
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /TS6053/);
});

test('base, Node, browser, and isomorphic consumers compile after installation', () => {
    for (const preset of ['base', 'node', 'web', 'isomorphic']) {
        configure(`@snovader/tsconfig/${preset}`, { outDir: './dist' });
        const result = compile();
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.equal(
            readFileSync(join(consumer, 'dist/example.d.ts'), 'utf8'),
            'export declare const answer: number;\n'
        );
        rmSync(join(consumer, 'dist'), { recursive: true });
    }
});

test('base reports unreachable code, unused labels, fallthrough, and non-erasable syntax', () => {
    writeFileSync(
        join(consumer, 'checks.ts'),
        `export enum Color { Red }
export function check(value: number): number {
    unused: for (;;) break;
    switch (value) {
        case 1:
            value++;
        case 2:
            return value;
    }
    return 0;
    value++;
}
`
    );
    configure('@snovader/tsconfig/base', { outDir: './dist' }, 'checks.ts');
    const result = compile();
    rmSync(join(consumer, 'dist'), { recursive: true, force: true });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /checks\.ts\(1,13\): error TS1294/);
    assert.match(result.stdout, /checks\.ts\(3,5\): error TS7028/);
    assert.match(result.stdout, /checks\.ts\(5,9\): error TS7029/);
    assert.match(result.stdout, /checks\.ts\(11,5\): error TS7027/);
});

test('consumers can turn erasableSyntaxOnly off', () => {
    writeFileSync(
        join(consumer, 'enum.ts'),
        'export enum Color { Red }\nexport class Point { constructor(readonly x: number) {} }\n'
    );
    configure(
        '@snovader/tsconfig/base',
        { erasableSyntaxOnly: false, outDir: './dist' },
        'enum.ts'
    );
    const result = compile();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(
        readFileSync(join(consumer, 'dist/enum.d.ts'), 'utf8'),
        /export declare enum Color/
    );
    rmSync(join(consumer, 'dist'), { recursive: true });
});

test('consumer settings override shared options and keep paths local', () => {
    configure('@snovader/tsconfig/base', {
        outDir: './local-output',
        customConditions: ['example-source'],
        erasableSyntaxOnly: false,
        types: ['node']
    });
    const config = showConfig();
    assert.equal(config.outDir, './local-output');
    assert.deepEqual(config.customConditions, ['example-source']);
    assert.deepEqual(config.types, ['node']);
    assert.equal(config.erasableSyntaxOnly, false);
    assert.equal(config.noFallthroughCasesInSwitch, true);
});

test('a local file listed after a preset adds options and keeps its types', () => {
    writeJson(join(consumer, 'tsconfig.local.json'), {
        compilerOptions: {
            customConditions: ['example-source'],
            erasableSyntaxOnly: false
        }
    });
    writeJson(join(consumer, 'tsconfig.json'), {
        extends: ['@snovader/tsconfig/node', './tsconfig.local.json'],
        files: ['example.ts']
    });
    const config = showConfig();
    assert.deepEqual(config.types, ['node']);
    assert.deepEqual(config.customConditions, ['example-source']);
    assert.equal(config.erasableSyntaxOnly, false);
    assert.equal(config.strict, true);
});

test('Yarn PnP resolves preset subpaths and inherits materialized presets', () => {
    const directory = join(sandbox, 'pnp-consumer');
    mkdirSync(directory);
    writeJson(join(directory, 'package.json'), {
        name: 'pnp-consumer',
        private: true,
        type: 'module',
        dependencies: {
            '@snovader/tsconfig': `file:${tarball}`,
            typescript: '7.0.2'
        },
        dependenciesMeta: {
            '@snovader/tsconfig': { unplugged: true }
        }
    });
    writeFileSync(join(directory, 'yarn.lock'), '');
    writeFileSync(
        join(directory, '.yarnrc.yml'),
        // This temporary consumer creates its own lockfile, including in CI.
        'nodeLinker: pnp\nenableTelemetry: false\nenableImmutableInstalls: false\n'
    );
    succeed(process.execPath, [yarn, 'install'], { cwd: directory });

    const resolved = JSON.parse(
        succeed(
            process.execPath,
            [
                yarn,
                'node',
                '-e',
                `const path = require('node:path'); console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(Object.keys(presets))}.map(name => [name, path.basename(require.resolve('@snovader/tsconfig/' + name))]))));`
            ],
            { cwd: directory }
        )
    );
    assert.deepEqual(resolved, presets);

    succeed(
        process.execPath,
        [
            yarn,
            'node',
            '-e',
            "const fs = require('node:fs'); const path = require('node:path'); fs.cpSync(path.dirname(require.resolve('@snovader/tsconfig/base')), '.cache/tsconfig', { recursive: true });"
        ],
        { cwd: directory }
    );
    writeFileSync(
        join(directory, 'example.ts'),
        'export const answer: number = 42;\n'
    );
    writeJson(join(directory, 'tsconfig.json'), {
        extends: './.cache/tsconfig/tsconfig.base.json',
        compilerOptions: { outDir: './dist' },
        files: ['example.ts']
    });
    const config = showConfig({ cwd: directory });
    assert.equal(config.strict, true);
    assert.equal(config.erasableSyntaxOnly, true);
    succeed(process.execPath, [yarn, 'tsc', '--project', 'tsconfig.json'], {
        cwd: directory
    });
    assert.equal(
        readFileSync(join(directory, 'dist/example.d.ts'), 'utf8'),
        'export declare const answer: number;\n'
    );
});
