import assert from 'node:assert/strict';
import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import {
    createSandbox,
    installNodeModules,
    installPnp,
    pack,
    run,
    succeed,
    writeJson,
    ROOT,
    YARN,
    type Options,
    type Result
} from './consumers.ts';

interface CompilerOptions {
    readonly allowImportingTsExtensions?: boolean;
    readonly allowUnreachableCode?: boolean;
    readonly allowUnusedLabels?: boolean;
    readonly composite?: boolean;
    readonly customConditions?: readonly string[];
    readonly emitDeclarationOnly?: boolean;
    readonly erasableSyntaxOnly?: boolean;
    readonly jsx?: string;
    readonly jsxImportSource?: string;
    readonly lib?: readonly string[];
    readonly module?: string;
    readonly noEmit?: boolean;
    readonly noFallthroughCasesInSwitch?: boolean;
    readonly noImplicitOverride?: boolean;
    readonly noUncheckedSideEffectImports?: boolean;
    readonly outDir?: string;
    readonly rewriteRelativeImportExtensions?: boolean;
    readonly rootDir?: string;
    readonly strict?: boolean;
    readonly types?: readonly string[];
}

const TSC = join(ROOT, 'node_modules/typescript/bin/tsc');

/** The presets by the subpaths that the package exports them under */
const PRESETS: Readonly<Record<string, string>> = {
    base: 'tsconfig.base.json',
    node: 'tsconfig.node.json',
    isomorphic: 'tsconfig.isomorphic.json',
    web: 'tsconfig.web.json',
    'web-preact': 'tsconfig.web-preact.json',
    'cloudflare-workers': 'tsconfig.cloudflare-workers.json',
    'cloudflare-workers/test': 'tsconfig.cloudflare-workers-test.json'
};
const SUBPATHS: Readonly<Record<string, string>> = {
    ...PRESETS,
    composite: 'tsconfig.composite.json'
};

const sandbox = createSandbox();
const consumer = join(sandbox, 'consumer');
const tarball = pack('@snovader/tsconfig', sandbox);

installNodeModules(consumer, [tarball]);
// The consumer supplies its compiler and environment typings
symlinkSync(join(ROOT, 'node_modules/@types'), join(consumer, 'node_modules/@types'));
writeFileSync(join(consumer, 'value.ts'), 'export const value: number = 41;\n');
writeFileSync(
    join(consumer, 'example.ts'),
    "import { value } from './value.ts';\nexport const answer: number = value + 1;\n"
);

after(() => rmSync(sandbox, { recursive: true, force: true }));

function configure(
    extended: string,
    compilerOptions: CompilerOptions = {},
    source = 'example.ts'
): void {
    writeJson(join(consumer, 'tsconfig.json'), {
        extends: extended,
        compilerOptions,
        files: [source]
    });
}

// TypeScript 7 prints an empty configuration and exits successfully when
// `extends` does not resolve, so callers assert on the inherited options
function showConfig(options: Options = { cwd: consumer }): CompilerOptions {
    const output = succeed(process.execPath, [TSC, '--showConfig'], options);

    return (JSON.parse(output) as { compilerOptions: CompilerOptions }).compilerOptions;
}

function compile(options: Options = { cwd: consumer }): Result {
    return run(process.execPath, [TSC, '--project', 'tsconfig.json'], options);
}

/** The files that tsc wrote to a directory */
function emitted(directory: string): string[] {
    return readdirSync(directory).filter(name => /\.(?:js|d\.ts|tsbuildinfo)$/.test(name));
}

for (const preset of Object.keys(PRESETS)) {
    test(`packed TypeScript ${preset} subpath resolves and inherits the base options`, () => {
        configure(`@snovader/tsconfig/${preset}`);
        const config = showConfig();
        assert.equal(config.module, 'nodenext');
        assert.equal(config.noEmit, true);
        assert.equal(config.composite, undefined);
        assert.equal(config.emitDeclarationOnly, undefined);
        assert.equal(config.noImplicitOverride, true);
        assert.equal(config.allowUnreachableCode, false);
        assert.equal(config.allowUnusedLabels, false);
        assert.equal(config.noFallthroughCasesInSwitch, true);
        assert.equal(config.erasableSyntaxOnly, true);
        if (preset === 'base') {
            assert.deepEqual(config.types, []);
        }
        if (preset === 'node') {
            assert.deepEqual(config.types, ['node']);
        }
        if (preset === 'web') {
            assert.deepEqual(config.lib, ['dom', 'esnext']);
        }
        if (preset === 'isomorphic') {
            assert.deepEqual(config.lib, ['esnext', 'webworker']);
        }
        if (preset === 'web-preact') {
            assert.deepEqual(config.lib, ['dom', 'esnext']);
            assert.equal(config.jsx, 'react-jsx');
            assert.equal(config.jsxImportSource, 'preact');
        }
        if (preset === 'cloudflare-workers') {
            assert.deepEqual(config.types, ['@cloudflare/workers-types']);
        }
        if (preset === 'cloudflare-workers/test') {
            assert.deepEqual(config.types, [
                '@cloudflare/workers-types',
                '@cloudflare/vitest-plugin/types'
            ]);
        }
    });
}

test('preset file paths are not exported', () => {
    configure('@snovader/tsconfig/tsconfig.base.json', { noEmit: true });
    const result = compile();
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /TS6053/);
});

test('base, Node, browser, and isomorphic consumers typecheck .ts imports without emitting', () => {
    for (const preset of ['base', 'node', 'web', 'isomorphic']) {
        configure(`@snovader/tsconfig/${preset}`);
        const result = compile();
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.deepEqual(emitted(consumer), []);
    }
});

test('web and isomorphic presets type DOM and worker iteration without iterable libraries', () => {
    writeFileSync(
        join(consumer, 'web.ts'),
        `export function names(): string[] {
    const result: string[] = [];
    for (const element of document.querySelectorAll('a'))
        result.push(element.href);
    for (const [key] of new FormData()) result.push(key);
    for (const node of document.body.childNodes) result.push(node.nodeName);
    return result;
}
`
    );
    writeFileSync(
        join(consumer, 'streams.ts'),
        `export async function read(
    stream: ReadableStream<string>,
    headers: Headers
): Promise<string[]> {
    const result: string[] = [];
    for await (const chunk of stream) result.push(chunk);
    for (const [key, value] of headers) result.push(key, value);
    for (const [key] of new URLSearchParams('a=1')) result.push(key);
    return result;
}
`
    );
    for (const [preset, source] of [
        ['web', 'web.ts'],
        ['web', 'streams.ts'],
        ['isomorphic', 'streams.ts']
    ]) {
        configure(`@snovader/tsconfig/${preset}`, {}, source);
        const result = compile();
        assert.equal(result.status, 0, result.stdout + result.stderr);
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
    configure('@snovader/tsconfig/base', {}, 'checks.ts');
    const result = compile();
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /checks\.ts\(1,13\): error TS1294/);
    assert.match(result.stdout, /checks\.ts\(3,5\): error TS7028/);
    assert.match(result.stdout, /checks\.ts\(5,9\): error TS7029/);
    assert.match(result.stdout, /checks\.ts\(11,5\): error TS7027/);
});

test("base relies on TypeScript 7's strict and side-effect import checks", () => {
    writeFileSync(
        join(consumer, 'defaults.ts'),
        `import './missing.js';
export function identity(value) {
    return value;
}
export const count: number = null;
`
    );
    configure('@snovader/tsconfig/base', {}, 'defaults.ts');
    const config = showConfig();
    assert.equal(config.strict, undefined);
    assert.equal(config.noUncheckedSideEffectImports, undefined);
    const result = compile();
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /defaults\.ts\(1,8\): error TS2882/);
    assert.match(result.stdout, /defaults\.ts\(2,26\): error TS7006/);
    assert.match(result.stdout, /defaults\.ts\(5,14\): error TS2322/);
});

test('consumers can turn erasableSyntaxOnly off', () => {
    writeFileSync(
        join(consumer, 'enum.ts'),
        'export enum Color { Red }\nexport class Point { constructor(readonly x: number) {} }\n'
    );
    configure('@snovader/tsconfig/base', { erasableSyntaxOnly: false }, 'enum.ts');
    const result = compile();
    assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('consumers emit JavaScript by turning noEmit off and rewriting .ts imports', () => {
    configure('@snovader/tsconfig/node', {
        noEmit: false,
        rewriteRelativeImportExtensions: true,
        rootDir: '.',
        outDir: './dist'
    });
    const result = compile();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(
        readFileSync(join(consumer, 'dist/example.js'), 'utf8'),
        "import { value } from './value.js';\nexport const answer = value + 1;\n"
    );
    assert.deepEqual(readdirSync(join(consumer, 'dist')).sort(), ['example.js', 'value.js']);
    rmSync(join(consumer, 'dist'), { recursive: true });
});

test('composite preset listed after an environment preset builds project references', () => {
    const monorepo = join(consumer, 'monorepo');
    mkdirSync(join(monorepo, 'shared'), { recursive: true });
    mkdirSync(join(monorepo, 'server'));
    writeFileSync(join(monorepo, 'shared/one.ts'), 'export const one: number = 1;\n');
    writeFileSync(
        join(monorepo, 'shared/index.ts'),
        "import { one } from './one.ts';\nexport const answer: number = one + 41;\n"
    );
    writeFileSync(
        join(monorepo, 'server/index.ts'),
        "import { answer } from '../shared/index.ts';\nexport const doubled: number = answer * 2;\n"
    );
    const project = (preset: string, references: readonly object[] = []): object => ({
        extends: [`@snovader/tsconfig/${preset}`, '@snovader/tsconfig/composite'],
        compilerOptions: { rootDir: '.', outDir: './dist' },
        include: ['*.ts'],
        references
    });
    writeJson(join(monorepo, 'shared/tsconfig.json'), project('isomorphic'));
    writeJson(join(monorepo, 'server/tsconfig.json'), project('node', [{ path: '../shared' }]));
    writeJson(join(monorepo, 'tsconfig.json'), {
        files: [],
        references: [{ path: './shared' }, { path: './server' }]
    });

    const config = showConfig({ cwd: join(monorepo, 'server') });
    assert.equal(config.composite, true);
    assert.equal(config.noEmit, false);
    assert.equal(config.emitDeclarationOnly, true);
    assert.equal(config.allowImportingTsExtensions, true);
    assert.deepEqual(config.types, ['node']);
    assert.equal(config.erasableSyntaxOnly, true);
    assert.equal(config.noImplicitOverride, true);

    // A second build finds the first one's output up to date
    for (let build = 0; build < 2; build++) {
        succeed(process.execPath, [TSC, '--build'], { cwd: monorepo });
    }
    assert.deepEqual(readdirSync(join(monorepo, 'shared/dist')).sort(), [
        'index.d.ts',
        'one.d.ts',
        'tsconfig.tsbuildinfo'
    ]);
    assert.equal(
        readFileSync(join(monorepo, 'server/dist/index.d.ts'), 'utf8'),
        'export declare const doubled: number;\n'
    );
    assert.ok(!existsSync(join(monorepo, 'server/dist/index.js')));
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
    assert.equal(config.noImplicitOverride, true);
});

test('Yarn PnP resolves preset subpaths and inherits materialized presets', () => {
    const directory = join(sandbox, 'pnp-consumer');
    const options: Options = { cwd: directory };
    installPnp(directory, {
        dependencies: {
            '@snovader/tsconfig': `file:${tarball}`,
            typescript: '7.0.2'
        },
        dependenciesMeta: {
            '@snovader/tsconfig': { unplugged: true }
        }
    });

    const resolve = `const path = require('node:path'); console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(Object.keys(SUBPATHS))}.map(name => [name, path.basename(require.resolve('@snovader/tsconfig/' + name))]))));`;
    const resolved = JSON.parse(
        succeed(process.execPath, [YARN, 'node', '-e', resolve], options)
    ) as Record<string, string>;
    assert.deepEqual(resolved, SUBPATHS);

    const materialize =
        "const fs = require('node:fs'); const path = require('node:path'); fs.cpSync(path.dirname(require.resolve('@snovader/tsconfig/base')), '.cache/tsconfig', { recursive: true });";
    succeed(process.execPath, [YARN, 'node', '-e', materialize], options);
    writeFileSync(join(directory, 'example.ts'), 'export const answer: number = 42;\n');
    writeJson(join(directory, 'tsconfig.json'), {
        extends: './.cache/tsconfig/tsconfig.base.json',
        files: ['example.ts']
    });
    const config = showConfig(options);
    assert.equal(config.noEmit, true);
    assert.equal(config.erasableSyntaxOnly, true);
    succeed(process.execPath, [YARN, 'tsc', '--project', 'tsconfig.json'], options);
    assert.deepEqual(emitted(directory), []);

    writeJson(join(directory, 'tsconfig.json'), {
        extends: [
            './.cache/tsconfig/tsconfig.base.json',
            './.cache/tsconfig/tsconfig.composite.json'
        ],
        compilerOptions: { rootDir: '.', outDir: './dist' },
        files: ['example.ts']
    });
    succeed(process.execPath, [YARN, 'tsc', '--build'], options);
    assert.equal(
        readFileSync(join(directory, 'dist/example.d.ts'), 'utf8'),
        'export declare const answer: number;\n'
    );
});
