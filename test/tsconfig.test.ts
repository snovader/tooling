import assert from 'node:assert/strict';
import { readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import {
    createSandbox,
    installNodeModules,
    installPnp,
    pack,
    succeed,
    writeJson,
    ROOT,
    YARN
} from './consumers.ts';

interface CompilerOptions {
    readonly strict?: boolean;
    readonly module?: string;
    readonly emitDeclarationOnly?: boolean;
    readonly noImplicitOverride?: boolean;
    readonly erasableSyntaxOnly?: boolean;
    readonly jsxImportSource?: string;
    readonly outDir?: string;
    readonly customConditions?: readonly string[];
    readonly types?: readonly string[];
    readonly lib?: readonly string[];
}

const tsc = join(ROOT, 'node_modules/typescript/bin/tsc');
const sandbox = createSandbox();
const consumer = join(sandbox, 'consumer');
const tarball = pack('@snovader/tsconfig', sandbox);

installNodeModules(consumer, [tarball]);
// The consumer supplies its compiler and environment typings
symlinkSync(join(ROOT, 'node_modules/@types'), join(consumer, 'node_modules/@types'));

after(() => rmSync(sandbox, { recursive: true, force: true }));

function configure(preset: string, compilerOptions: CompilerOptions = {}): void {
    writeFileSync(join(consumer, 'example.ts'), 'export const answer: number = 42;\n');
    writeJson(join(consumer, 'tsconfig.json'), {
        extends: `@snovader/tsconfig/tsconfig.${preset}.json`,
        compilerOptions,
        files: ['example.ts']
    });
}

/** The options that tsc resolves for the consumer's tsconfig */
function showConfig(): CompilerOptions {
    const output = succeed(process.execPath, [tsc, '--showConfig'], { cwd: consumer });

    return (JSON.parse(output) as { compilerOptions: CompilerOptions }).compilerOptions;
}

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
        configure(preset);
        const options = showConfig();
        assert.equal(options.strict, true);
        assert.equal(options.module, 'nodenext');
        assert.equal(options.emitDeclarationOnly, true);
        assert.equal(options.noImplicitOverride, true);
        if (preset === 'node') {
            assert.deepEqual(options.types, ['node']);
        }
        if (preset === 'web') {
            assert.ok((options.lib ?? []).includes('dom'));
        }
        if (preset === 'isomorphic') {
            const lib = options.lib ?? [];
            assert.ok(lib.includes('webworker'));
            assert.ok(!lib.includes('dom'));
        }
        if (preset === 'web-preact') {
            assert.equal(options.jsxImportSource, 'preact');
        }
        if (preset === 'cloudflare-workers') {
            assert.deepEqual(options.types, ['@cloudflare/workers-types']);
        }
        if (preset === 'cloudflare-workers-test') {
            assert.deepEqual(options.types, [
                '@cloudflare/workers-types',
                '@cloudflare/vitest-plugin/types'
            ]);
        }
    });
}

test('base, Node, browser, and isomorphic consumers compile after installation', () => {
    for (const preset of ['base', 'node', 'web', 'isomorphic']) {
        configure(preset, { outDir: './dist' });
        succeed(process.execPath, [tsc, '--project', 'tsconfig.json'], { cwd: consumer });
        assert.equal(
            readFileSync(join(consumer, 'dist/example.d.ts'), 'utf8'),
            'export declare const answer: number;\n'
        );
        rmSync(join(consumer, 'dist'), { recursive: true });
    }
});

test('consumer settings override shared options and keep paths local', () => {
    configure('base', {
        outDir: './local-output',
        customConditions: ['example-source'],
        erasableSyntaxOnly: true,
        types: ['node']
    });
    const options = showConfig();
    assert.equal(options.outDir, './local-output');
    assert.deepEqual(options.customConditions, ['example-source']);
    assert.deepEqual(options.types, ['node']);
    assert.equal(options.erasableSyntaxOnly, true);
});

test('a local file listed after a preset adds options and keeps its types', () => {
    writeJson(join(consumer, 'tsconfig.local.json'), {
        compilerOptions: {
            customConditions: ['example-source'],
            erasableSyntaxOnly: true
        }
    });
    writeJson(join(consumer, 'tsconfig.json'), {
        extends: ['@snovader/tsconfig/tsconfig.node.json', './tsconfig.local.json'],
        files: ['example.ts']
    });
    const options = showConfig();
    assert.deepEqual(options.types, ['node']);
    assert.deepEqual(options.customConditions, ['example-source']);
    assert.equal(options.erasableSyntaxOnly, true);
    assert.equal(options.strict, true);
});

test('Yarn PnP can materialize and inherit TypeScript presets', () => {
    const directory = join(sandbox, 'pnp-consumer');
    installPnp(directory, {
        dependencies: {
            '@snovader/tsconfig': `file:${tarball}`,
            typescript: '7.0.2'
        },
        dependenciesMeta: {
            '@snovader/tsconfig': { unplugged: true }
        }
    });
    const materialize =
        "const fs = require('node:fs'); const path = require('node:path'); fs.cpSync(path.dirname(require.resolve('@snovader/tsconfig/tsconfig.base.json')), '.cache/tsconfig', { recursive: true });";
    succeed(process.execPath, [YARN, 'node', '-e', materialize], { cwd: directory });

    writeFileSync(join(directory, 'example.ts'), 'export const answer: number = 42;\n');
    writeJson(join(directory, 'tsconfig.json'), {
        extends: './.cache/tsconfig/tsconfig.base.json',
        compilerOptions: { outDir: './dist' },
        files: ['example.ts']
    });
    succeed(process.execPath, [YARN, 'tsc', '--project', 'tsconfig.json'], { cwd: directory });
    assert.equal(
        readFileSync(join(directory, 'dist/example.d.ts'), 'utf8'),
        'export declare const answer: number;\n'
    );
});
