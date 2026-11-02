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
const sandbox = mkdtempSync(join(tmpdir(), 'snovader-tooling-'));
const consumer = join(sandbox, 'consumer');
const biome = join(root, 'node_modules/@biomejs/biome/bin/biome');
const tsc = join(root, 'node_modules/typescript/bin/tsc');
const yarn = join(root, '.yarn/releases/yarn-4.18.1.cjs');
let tarballs;

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

function configureBiome(value) {
    writeJson(join(consumer, 'biome.json'), value);
}

function lint(source, filename = 'example.ts', options = []) {
    writeFileSync(join(consumer, filename), source);
    return run(process.execPath, [biome, 'lint', filename, ...options]);
}

function configureRule(name) {
    configureBiome({
        plugins: [`@snovader/biome-config/${name}`],
        linter: { rules: { preset: 'none' } },
        assist: { enabled: false }
    });
}

function configureTypeScript(preset, compilerOptions = {}) {
    writeFileSync(
        join(consumer, 'example.ts'),
        'export const answer: number = 42;\n'
    );
    writeJson(join(consumer, 'tsconfig.json'), {
        extends: `@snovader/tsconfig/tsconfig.${preset}.json`,
        compilerOptions,
        files: ['example.ts']
    });
}

before(() => {
    mkdirSync(consumer);
    tarballs = ['biome-config', 'tsconfig'].map(name => {
        const output = succeed('npm', [
            'pack',
            join(root, 'packages', name),
            '--json',
            '--pack-destination',
            sandbox
        ]);
        return join(sandbox, Object.values(JSON.parse(output))[0].filename);
    });

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
        '--legacy-peer-deps',
        ...tarballs
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

test('packed base config formats TypeScript and loads its bundled rules', () => {
    configureBiome({ extends: ['@snovader/biome-config/configs/base'] });
    const formatted = succeed(
        process.execPath,
        [biome, 'format', '--stdin-file-path', 'example.ts'],
        {
            input: 'export function greeting(name:string):string {return "hello " + name}'
        }
    );
    assert.equal(
        formatted,
        "export function greeting(name: string): string {\n    return 'hello ' + name;\n}\n"
    );

    const result = lint(
        'export function values() { return [] as Array<string>; }'
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Declare the function's return type/);
    assert.match(result.stderr, /Use T\[\]/);
});

test('packed base config indents YAML by two spaces', () => {
    configureBiome({ extends: ['@snovader/biome-config/configs/base'] });
    const formatted = succeed(
        process.execPath,
        [biome, 'format', '--stdin-file-path', 'example.yml'],
        {
            input: 'jobs:\n    check:\n        steps:\n            - run: test\n'
        }
    );
    assert.equal(formatted, 'jobs:\n  check:\n    steps:\n      - run: test\n');
});

test('packed Preact config inherits formatting and JSX rules', () => {
    configureBiome({ extends: ['@snovader/biome-config/configs/preact'] });
    const result = lint(
        'export const items = [1, 2].map(value => <div>{value}</div>);',
        'example.tsx'
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /useJsxKeyInIterable/);
});

test('array rule reports and fixes simple and complex element types', () => {
    configureRule('useArraySimple');
    const result = lint(
        'export type Names = Array<string>;\nexport type Values = (string | number)[];\n',
        'example.ts',
        ['--write', '--unsafe']
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(
        readFileSync(join(consumer, 'example.ts'), 'utf8'),
        /type Names = string\[\]/
    );
    assert.match(
        readFileSync(join(consumer, 'example.ts'), 'utf8'),
        /type Values = Array<string \| number>/
    );
});

test('array rule preserves valid readonly, nested, generic, and heritage types', () => {
    configureRule('useArraySimple');
    const result = lint(`
export type Names = readonly string[];
export type Matrix = number[][];
export type Pairs = ReadonlyArray<[string, number]>;
export interface NamesList extends Array<string> {}
`);
    assert.equal(result.status, 0, result.stderr);
});

test('return rule reports declarations, getters, and function-valued variables', () => {
    configureRule('useExplicitReturnType');
    const result = lint(`
export function answer() { return 42; }
export const value = () => 42;
export class Example { get answer() { return 42; } }
`);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Declare the function's return type/);
    assert.match(result.stderr, /Declare the getter's return type/);
    assert.match(result.stderr, /variable's type/);
});

test('return rule accepts annotated, contextual, callback, override, and self-typed functions', () => {
    configureRule('useExplicitReturnType');
    const result = lint(`
export function answer(): number { return 42; }
export const typed: () => number = () => 42;
export const object: { value(): number } = { value() { return 42; } };
export const values = [1, 2].map(value => value * 2);
export class Base { value(): number { return 1; } }
export class Derived extends Base { override value() { return 2; } }
export const literal = () => 42 as const;
export const factory = () => (): number => 42;
`);
    assert.equal(result.status, 0, result.stderr);
});

test('return rule skips JavaScript files', () => {
    configureRule('useExplicitReturnType');
    const result = lint(
        'export function answer() { return 42; }',
        'example.js'
    );
    assert.equal(result.status, 0, result.stderr);
});

test('named rule preset enables both rules without changing formatting', () => {
    configureRule('presets/recommended');
    const result = lint(
        'export function values() { return [] as Array<string>; }'
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Declare the function's return type/);
    assert.match(result.stderr, /Use T\[\]/);
});

test('individual rules can be enabled independently', () => {
    configureRule('useArraySimple');
    const result = lint('export function answer() { return 42; }');
    assert.equal(result.status, 0, result.stderr);
});

for (const preset of [
    'base',
    'node',
    'isomorphic',
    'web',
    'web-preact',
    'cloudflare-workers',
    'cloudflare-workers-test'
]) {
    test(`packed TypeScript ${preset} preset resolves and inherits strict checking`, () => {
        configureTypeScript(preset);
        const config = JSON.parse(
            succeed(process.execPath, [tsc, '--showConfig'])
        );
        assert.equal(config.compilerOptions.strict, true);
        assert.equal(config.compilerOptions.module, 'nodenext');
        assert.equal(config.compilerOptions.emitDeclarationOnly, true);
        assert.equal(config.compilerOptions.noImplicitOverride, true);
        if (preset === 'node')
            assert.deepEqual(config.compilerOptions.types, ['node']);
        if (preset === 'web')
            assert.ok(config.compilerOptions.lib.includes('dom'));
        if (preset === 'isomorphic') {
            assert.ok(config.compilerOptions.lib.includes('webworker'));
            assert.ok(!config.compilerOptions.lib.includes('dom'));
        }
        if (preset === 'web-preact')
            assert.equal(config.compilerOptions.jsxImportSource, 'preact');
        if (preset === 'cloudflare-workers') {
            assert.deepEqual(config.compilerOptions.types, [
                '@cloudflare/workers-types'
            ]);
        }
        if (preset === 'cloudflare-workers-test') {
            assert.deepEqual(config.compilerOptions.types, [
                '@cloudflare/workers-types',
                '@cloudflare/vitest-plugin/types'
            ]);
        }
    });
}

test('base, Node, browser, and isomorphic consumers compile after installation', () => {
    for (const preset of ['base', 'node', 'web', 'isomorphic']) {
        configureTypeScript(preset, { outDir: './dist' });
        succeed(process.execPath, [tsc, '--project', 'tsconfig.json']);
        assert.equal(
            readFileSync(join(consumer, 'dist/example.d.ts'), 'utf8'),
            'export declare const answer: number;\n'
        );
        rmSync(join(consumer, 'dist'), { recursive: true });
    }
});

test('consumer settings override shared options and keep paths local', () => {
    configureTypeScript('base', {
        outDir: './local-output',
        customConditions: ['example-source'],
        erasableSyntaxOnly: true,
        types: ['node']
    });
    const config = JSON.parse(succeed(process.execPath, [tsc, '--showConfig']));
    assert.equal(config.compilerOptions.outDir, './local-output');
    assert.deepEqual(config.compilerOptions.customConditions, [
        'example-source'
    ]);
    assert.deepEqual(config.compilerOptions.types, ['node']);
    assert.equal(config.compilerOptions.erasableSyntaxOnly, true);
});

test('a local file listed after a preset adds options and keeps its types', () => {
    writeJson(join(consumer, 'tsconfig.local.json'), {
        compilerOptions: {
            customConditions: ['example-source'],
            erasableSyntaxOnly: true
        }
    });
    writeJson(join(consumer, 'tsconfig.json'), {
        extends: [
            '@snovader/tsconfig/tsconfig.node.json',
            './tsconfig.local.json'
        ],
        files: ['example.ts']
    });
    const config = JSON.parse(succeed(process.execPath, [tsc, '--showConfig']));
    assert.deepEqual(config.compilerOptions.types, ['node']);
    assert.deepEqual(config.compilerOptions.customConditions, [
        'example-source'
    ]);
    assert.equal(config.compilerOptions.erasableSyntaxOnly, true);
    assert.equal(config.compilerOptions.strict, true);
});

function preparePnpConsumer(directory) {
    mkdirSync(directory);
    writeJson(join(directory, 'package.json'), {
        name: 'pnp-consumer',
        private: true,
        type: 'module',
        dependencies: {
            '@biomejs/biome': '2.6.4',
            '@snovader/biome-config': `file:${tarballs[0]}`,
            '@snovader/tsconfig': `file:${tarballs[1]}`,
            typescript: '7.0.2'
        },
        dependenciesMeta: {
            '@snovader/biome-config': { unplugged: true },
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
}

test('Yarn PnP can materialize Biome configs and inherit TypeScript presets', () => {
    const directory = join(sandbox, 'pnp-consumer');
    preparePnpConsumer(directory);
    const materialize =
        "const fs = require('node:fs'); const path = require('node:path'); fs.cpSync(path.dirname(require.resolve('@snovader/biome-config')), '.cache/biome-config', { recursive: true }); fs.cpSync(path.dirname(require.resolve('@snovader/tsconfig/tsconfig.base.json')), '.cache/tsconfig', { recursive: true });";
    succeed(
        process.execPath,
        [yarn, 'node', '--conditions=biome', '-e', materialize],
        { cwd: directory }
    );
    writeJson(join(directory, 'biome.json'), {
        extends: ['./.cache/biome-config/configs/preact.json'],
        files: { includes: ['**', '!.cache', '!.yarn', '!.pnp.*'] }
    });
    writeFileSync(
        join(directory, 'example.ts'),
        'export function answer() { return 42; }\n'
    );
    const result = run(process.execPath, [biome, 'lint', 'example.ts'], {
        cwd: directory
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Declare the function's return type/);

    writeFileSync(
        join(directory, 'example.ts'),
        'export const answer: number = 42;\n'
    );
    writeJson(join(directory, 'tsconfig.json'), {
        extends: './.cache/tsconfig/tsconfig.base.json',
        compilerOptions: { outDir: './dist' },
        files: ['example.ts']
    });
    succeed(process.execPath, [yarn, 'tsc', '--project', 'tsconfig.json'], {
        cwd: directory
    });
    assert.equal(
        readFileSync(join(directory, 'dist/example.d.ts'), 'utf8'),
        'export declare const answer: number;\n'
    );
});
