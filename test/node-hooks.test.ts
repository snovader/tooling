import assert from 'node:assert/strict';
import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import {
    createSandbox,
    installNodeModules,
    pack,
    run,
    succeed,
    ROOT,
    YARN,
    type Options,
    type Result
} from './consumers.ts';

/** A file's text, its bytes, or an object to write as JSON */
type Content = string | Buffer | object;

/** A case for the PnP resolve hook, which `pathProbe` runs */
interface PathProbe {
    readonly windows: boolean;
    readonly files: Readonly<Record<string, unknown>>;
    readonly specifier: string;
    readonly parentURL: string;
}

interface PathCase {
    readonly name: string;
    readonly probe: PathProbe;
    readonly expected: unknown;
}

const packageDirectory = join(ROOT, 'packages/node-hooks');
const register = '@snovader/node-hooks/register';
const entryPoints = ['register', 'typescript', 'bytes', 'cache', 'pnp'];
const protectorInvalidation = /Invalidating protector cell ArrayBufferDetaching/;

const sandbox = createSandbox();
const consumer = join(sandbox, 'consumer');
// Yarn packs the exports of publishConfig, which name the build
const tarball = pack('@snovader/node-hooks', sandbox);
installNodeModules(consumer, [tarball]);

after(() => rmSync(sandbox, { recursive: true, force: true }));

/** Runs Node in the consumer, unless told another directory */
function node(args: readonly string[], options: Partial<Options> = {}): Result {
    return run(process.execPath, args, { cwd: consumer, ...options });
}

/** Runs Node, which has to succeed, and parses the JSON that it prints */
function nodeJson(args: readonly string[], options: Partial<Options> = {}): unknown {
    return JSON.parse(succeed(process.execPath, args, { cwd: consumer, ...options }));
}

/** Writes files by path, with objects as JSON and buffers as bytes */
function writeFiles(directory: string, files: Readonly<Record<string, Content>>): void {
    for (const [path, content] of Object.entries(files)) {
        const file = join(directory, path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(
            file,
            typeof content === 'string' || Buffer.isBuffer(content)
                ? content
                : `${JSON.stringify(content, null, 4)}\n`
        );
    }
}

/** A module of typed functions, larger than amaro's initial memory */
function largeModule(functionCount: number, exportKeyword = 'export '): string {
    const functions = Array.from(
        { length: functionCount },
        (_, index) =>
            `${exportKeyword}function scale${index}(value: number, factor: number): number {\n    return value * factor + ${index};\n}\n`
    );
    return functions.join('\n');
}

function assertProtectorIntact(result: Result): void {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /loaded/);
    assert.doesNotMatch(result.stdout + result.stderr, protectorInvalidation);
}

test('the packed package exports each hook from its build, with types', () => {
    const installed = realpathSync(join(consumer, 'node_modules/@snovader/node-hooks'));
    const { exports } = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8')) as {
        exports: unknown;
    };
    assert.deepEqual(
        exports,
        Object.fromEntries(
            entryPoints.map(name => [
                `./${name}`,
                { types: `./dist/${name}.d.ts`, default: `./dist/${name}.js` }
            ])
        )
    );
    for (const name of entryPoints) {
        assert.ok(existsSync(join(installed, `dist/${name}.d.ts`)), name);
    }
    assert.ok(!existsSync(join(installed, 'source')));

    writeFiles(consumer, {
        'entries/resolve.mjs': `const names = ${JSON.stringify(entryPoints)};
console.log(JSON.stringify(names.map(name => import.meta.resolve(\`@snovader/node-hooks/\${name}\`))));
`
    });
    const resolved = nodeJson(['entries/resolve.mjs']) as string[];
    for (const [index, name] of entryPoints.entries()) {
        assert.equal(resolved[index], pathToFileURL(join(installed, `dist/${name}.js`)).href);
    }
});

test('packing with npm fails, as npm would keep the exports that name the source', () => {
    // npm keeps a user agent that it inherits, as from Yarn running the tests
    const env = { ...process.env };
    delete env.npm_config_user_agent;
    const result = run('npm', ['pack', '--pack-destination', sandbox], {
        cwd: packageDirectory,
        env
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Pack and publish @snovader\/node-hooks with Yarn/);
    assert.ok(!readdirSync(sandbox).some(file => file.startsWith('snovader-node-hooks-')));
});

test('register loads TypeScript as ES modules and CommonJS by package type and extension', () => {
    writeFiles(consumer, {
        'formats/module/package.json': { type: 'module' },
        'formats/module/value.ts':
            "interface Named {\n    name: string;\n}\n\nconst value: Named = { name: 'module' };\nexport default value.name;\n",
        'formats/commonjs/package.json': { type: 'commonjs' },
        'formats/commonjs/value.ts': "const name: string = 'commonjs';\nmodule.exports = name;\n",
        'formats/untyped/package.json': {},
        'formats/untyped/value.ts': "export default 'untyped' as string;\n",
        'formats/value.mts': "export default 'mts' as string;\n",
        'formats/value.cts': "const name: string = 'cts';\nmodule.exports = name;\n",
        'formats/entry.ts': `import { createRequire } from 'node:module';
import moduleValue from './module/value.ts';
import commonjsValue from './commonjs/value.ts';
import untypedValue from './untyped/value.ts';
import mtsValue from './value.mts';
import ctsValue from './value.cts';

const require = createRequire(import.meta.url);
const required: string[] = [require('./commonjs/value.ts'), require('./value.cts')];
const imported: string[] = [moduleValue, commonjsValue, untypedValue, mtsValue, ctsValue];
console.log(JSON.stringify({ imported, required }));
`
    });

    assert.deepEqual(nodeJson(['--import', register, 'formats/entry.ts']), {
        imported: ['module', 'commonjs', 'untyped', 'mts', 'cts'],
        required: ['commonjs', 'cts']
    });
});

test('register loads TypeScript inside node_modules, which Node refuses', () => {
    writeFiles(consumer, {
        'packaged/node_modules/typed/package.json': {
            name: 'typed',
            type: 'module',
            exports: './index.ts'
        },
        'packaged/node_modules/typed/index.ts': "export const source: string = 'package';\n",
        'packaged/entry.mjs':
            "import { source } from 'typed';\n\nconsole.log(JSON.stringify(source));\n"
    });

    assert.equal(nodeJson(['--import', register, 'packaged/entry.mjs']), 'package');

    const stripped = node(['packaged/entry.mjs']);
    assert.notEqual(stripped.status, 0);
    assert.match(stripped.stderr, /ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING/);
});

test('register keeps an import of only inline types for its side effects, as Node does', () => {
    writeFiles(consumer, {
        'imports/registry.ts':
            'export interface Shape {\n    width: number;\n}\n\n(globalThis as { registered?: boolean }).registered = true;\n',
        'imports/entry.ts': `import { type Shape } from './registry.ts';

const shape: Shape = { width: 2 };
const { registered } = globalThis as { registered?: boolean };
console.log(JSON.stringify({ registered, width: shape.width }));
`
    });

    const hooked = nodeJson(['--import', register, 'imports/entry.ts']);
    assert.deepEqual(hooked, { registered: true, width: 2 });
    assert.deepEqual(nodeJson(['imports/entry.ts']), hooked);
});

test('register compiles TypeScript that Node only strips, such as enums', () => {
    writeFiles(consumer, {
        'enums/entry.ts':
            'enum Direction {\n    Up = 1,\n    Down\n}\n\nconsole.log(JSON.stringify(Direction.Down));\n'
    });

    assert.equal(nodeJson(['--import', register, 'enums/entry.ts']), 2);
});

test('register leaves the ArrayBufferDetaching protector intact for a large module', () => {
    const source = `${largeModule(150)}\nconsole.log('loaded');\n`;
    assert.ok(source.length > 8000);
    writeFiles(consumer, { 'protector/large.ts': source });

    assertProtectorIntact(
        node(['--trace-protector-invalidation', '--import', register, 'protector/large.ts'])
    );

    // The same module through Node's own stripping shows that it's large enough
    const stripped = node(['--trace-protector-invalidation', 'protector/large.ts']);
    assert.equal(stripped.status, 0, stripped.stderr);
    assert.match(
        stripped.stdout,
        protectorInvalidation,
        "Node's type stripping no longer invalidates the protector"
    );
});

test('register leaves the protector intact for large CommonJS that is required, or imported without Node stripping', () => {
    writeFiles(consumer, {
        'protector/large.cts': `${largeModule(150, '')}\nmodule.exports = { scale0 };\n`,
        'protector/require.cjs': "require('./large.cts');\nconsole.log('loaded');\n",
        'protector/import.mjs': "await import('./large.cts');\nconsole.log('loaded');\n"
    });

    assertProtectorIntact(
        node(['--trace-protector-invalidation', '--import', register, 'protector/require.cjs'])
    );
    assertProtectorIntact(
        node([
            '--no-strip-types',
            '--trace-protector-invalidation',
            '--import',
            register,
            'protector/import.mjs'
        ])
    );
});

test('register maps stack traces to TypeScript lines with --enable-source-maps', () => {
    writeFiles(consumer, {
        'maps/thrower.ts': `interface Shape {
    width: number;
}

export function fail(shape: Shape): never {
    throw new Error(\`width \${shape.width}\`);
}
`,
        'maps/entry.ts':
            "import { fail } from './thrower.ts';\n\ntry {\n    fail({ width: 1 });\n} catch (error) {\n    console.log((error as Error).stack);\n}\n"
    });

    const stack = succeed(
        process.execPath,
        ['--enable-source-maps', '--import', register, 'maps/entry.ts'],
        { cwd: consumer }
    );
    assert.match(stack, /thrower\.ts:6:11/);
    assert.match(stack, /entry\.ts:4:5/);
});

test('TypeScript hook strips the TypeScript that the next hook loads, and leaves its JavaScript as it is', () => {
    writeFiles(consumer, {
        // Registered before the TypeScript hook, so that it runs after it
        'next-load/register.mjs': `import { registerHooks } from 'node:module';
import { load } from '@snovader/node-hooks/typescript';

registerHooks({
    load(url, context, nextLoad) {
        if (url.endsWith('/generated.ts')) {
            const source = "export function label(): string {\\n    return 'generated';\\n}\\n";
            return { format: 'module-typescript', source, shortCircuit: true };
        }
        if (url.endsWith('/compiled.ts')) {
            const source = "export function label() {\\n    return 'compiled';\\n}\\n";
            return { format: 'module', source, shortCircuit: true };
        }
        return nextLoad(url, context);
    }
});
registerHooks({ load });
`,
        'next-load/generated.ts': 'export const label: string = "on disk";\n',
        'next-load/compiled.ts': 'export const label: string = "on disk";\n',
        'next-load/entry.ts': `import { label as generated } from './generated.ts';
import { label as compiled } from './compiled.ts';

console.log(JSON.stringify({
    values: [generated(), compiled()],
    // oxc prints its output anew, with double quotes
    sources: [generated.toString(), compiled.toString()]
}));
`
    });

    assert.deepEqual(
        nodeJson([
            '--no-strip-types',
            '--import',
            './next-load/register.mjs',
            'next-load/entry.ts'
        ]),
        {
            values: ['generated', 'compiled'],
            sources: [
                'function label() {\n\treturn "generated";\n}',
                "function label() {\n    return 'compiled';\n}"
            ]
        }
    );
});

const thrower = `interface Shape {
    width: number;
}

export function fail(shape: Shape): never {
    throw new Error(\`width \${shape.width}\`);
}
`;
const throwerLineCount = thrower.split('\n').length;

/**
 * Runs a module whose source the next hook prepends two lines to, and
 * appends a source map to, which `map` writes from the module's `url`, and
 * returns what it prints: a line that the prepended code sets, and the stack
 * of an error that the module throws at its line 6. The map's comment
 * starts with `comment`, and `after` follows it.
 */
interface NextMapOptions {
    readonly comment?: string;
    readonly after?: string;
}

function stackThroughNextMap(
    directory: string,
    map: string,
    {
        comment = '//# sourceMappingURL=data:application/json;base64,',
        after = '\n'
    }: NextMapOptions = {}
): string {
    writeFiles(consumer, {
        [`${directory}/register.mjs`]: `import { registerHooks } from 'node:module';
import { load } from '@snovader/node-hooks/typescript';

registerHooks({
    load(url, context, nextLoad) {
        const loaded = nextLoad(url, context);
        if (!url.endsWith('/thrower.ts')) {
            return loaded;
        }

        const map = ${map};
        const encoded = Buffer.from(JSON.stringify(map)).toString('base64');
        const source = \`export const added: number = 1;\\nexport const lines: number = 2;\\n\${loaded.source}\\n${comment}\${encoded}${JSON.stringify(after).slice(1, -1)}\`;
        return { ...loaded, source };
    }
});
registerHooks({ load });
`,
        [`${directory}/thrower.ts`]: thrower,
        [`${directory}/entry.ts`]:
            "import { added, fail } from './thrower.ts';\n\nconsole.log(`added ${added}`);\ntry {\n    fail({ width: 1 });\n} catch (error) {\n    console.log((error as Error).stack);\n}\n"
    });

    const output = succeed(
        process.execPath,
        [
            '--enable-source-maps',
            '--no-strip-types',
            '--import',
            `./${directory}/register.mjs`,
            `${directory}/entry.ts`
        ],
        { cwd: consumer }
    );
    assert.match(output, /^added 1$/m);
    assert.match(output, /entry\.ts:5:5/);
    return output;
}

test('TypeScript hook maps stack traces through a source map that the next hook appends', () => {
    // Each line after the two prepended ones maps to the line two above it
    const mappings = `;;AAAA${';AACA'.repeat(throwerLineCount - 1)}`;
    const output = stackThroughNextMap(
        'next-map',
        `{ version: 3, sources: [url], names: [], mappings: ${JSON.stringify(mappings)} }`
    );

    assert.match(output, /thrower\.ts:6:\d+/);
});

test('TypeScript hook maps stack traces through an index map of sections that the next hook appends', () => {
    // The module's first three lines in one section, and the rest in another
    const first = 'AAAA;AACA;AACA';
    const rest = `AAGA${';AACA'.repeat(throwerLineCount - 4)}`;
    const output = stackThroughNextMap(
        'next-index-map',
        `{ version: 3, sections: [
            { offset: { line: 2, column: 0 }, map: { version: 3, sources: [url], names: [], mappings: '${first}' } },
            { offset: { line: 5, column: 0 }, map: { version: 3, sources: [url], names: [], mappings: '${rest}' } }
        ] }`
    );

    assert.match(output, /thrower\.ts:6:\d+/);
});

test('TypeScript hook maps through a map with a charset, followed by whitespace', () => {
    const mappings = `;;AAAA${';AACA'.repeat(throwerLineCount - 1)}`;
    const output = stackThroughNextMap(
        'next-map-charset',
        `{ version: 3, sources: [url], names: [], mappings: ${JSON.stringify(mappings)} }`,
        {
            comment: '//# sourceMappingURL=data:application/json;charset=utf-8;base64,',
            after: '\r\n\t \r\n'
        }
    );

    assert.match(output, /thrower\.ts:6:\d+/);
});

test('TypeScript hook leaves an inline map that code follows, and maps to the code as the next hook gives it', () => {
    const mappings = `;;AAAA${';AACA'.repeat(throwerLineCount - 1)}`;
    const output = stackThroughNextMap(
        'next-map-before-code',
        `{ version: 3, sources: [url], names: [], mappings: ${JSON.stringify(mappings)} }`,
        { after: '\nexport const later: number = 3;\n' }
    );

    // The hook's own map comes last, which Node reads
    assert.match(output, /thrower\.ts:8:\d+/);
});

test('TypeScript hook drops an inline map that is not a source map, and maps to the code as the next hook gives it', () => {
    const output = stackThroughNextMap('next-invalid-map', '{ version: 3 }');

    // Two lines below where it's written, past the prepended lines
    assert.match(output, /thrower\.ts:8:\d+/);
});

test('register fails a module with invalid syntax with a SyntaxError and a code frame', () => {
    writeFiles(consumer, {
        'errors/invalid.ts': 'export const width: number = ;\n',
        'errors/entry.mjs': `try {
    await import('./invalid.ts');
} catch (error) {
    console.log(JSON.stringify({ name: error.name, message: error.message }));
}
`
    });

    const { name, message } = nodeJson(['--import', register, 'errors/entry.mjs']) as {
        name: string;
        message: string;
    };
    assert.equal(name, 'SyntaxError');
    assert.match(message, /Unexpected token/);
    assert.match(message, /invalid\.ts:1:/);
});

test('register loads TypeScript from paths that URLs percent-encode', () => {
    writeFiles(consumer, {
        'paths/with space/åäö/value.ts': "export default 'encoded' as string;\n",
        'paths/entry.ts':
            "import value from './with space/åäö/value.ts';\n\nconsole.log(JSON.stringify(value));\n"
    });

    assert.equal(nodeJson(['--import', register, 'paths/entry.ts']), 'encoded');
});

test('JSX options compile .tsx files, which register leaves to Node', () => {
    writeFiles(consumer, {
        'jsx/register.mjs': `import { registerHooks } from 'node:module';
import { createLoadHook } from '@snovader/node-hooks/typescript';

registerHooks({ load: createLoadHook({ jsx: { runtime: 'classic', pragma: 'h' } }) });
`,
        'jsx/view.tsx': `function h(type: string, props: object | null, ...children: unknown[]) {
    return { type, props, children };
}

export const view = <p title="greeting">{'hello'}</p>;
`,
        'jsx/entry.mjs':
            "const { view } = await import('./view.tsx');\nconsole.log(JSON.stringify(view));\n"
    });

    assert.deepEqual(nodeJson(['--import', './jsx/register.mjs', 'jsx/entry.mjs']), {
        type: 'p',
        props: { title: 'greeting' },
        children: ['hello']
    });

    const unhandled = node(['--import', register, 'jsx/entry.mjs']);
    assert.notEqual(unhandled.status, 0);
    assert.match(unhandled.stderr, /ERR_UNKNOWN_FILE_EXTENSION/);
});

test('bytes hook imports a file as a Uint8Array of its contents', () => {
    writeFiles(consumer, {
        'bytes/data files/blob.bin': Buffer.from([0, 255, 10, 13, 128]),
        'bytes/register.mjs': `import { registerHooks } from 'node:module';
import { load } from '@snovader/node-hooks/bytes';

registerHooks({ load });
`,
        'bytes/entry.mjs': `import bytes from './data files/blob.bin' with { type: 'bytes' };
import again from './data files/blob.bin' with { type: 'bytes' };

console.log(JSON.stringify({
    isUint8Array: bytes instanceof Uint8Array,
    values: [...bytes],
    same: bytes === again
}));
`
    });

    assert.deepEqual(nodeJson(['--import', './bytes/register.mjs', 'bytes/entry.mjs']), {
        isUint8Array: true,
        values: [0, 255, 10, 13, 128],
        same: true
    });
});

/**
 * Runs the PnP resolve hook on Windows or POSIX paths on any platform. The
 * hooks choose by `process.platform`, which the probe sets before importing
 * them. Drives and UNC shares don't exist everywhere, so the probe replaces
 * fs with the case's files and prints the package.json paths the hook reads.
 */
const pathProbe = `import fs from 'node:fs';

const { windows, files, specifier, parentURL } = JSON.parse(process.argv[2]);

if (windows !== (process.platform === 'win32')) {
    Object.defineProperty(process, 'platform', { value: windows ? 'win32' : 'linux' });
}
const { resolve } = await import('@snovader/node-hooks/pnp');

const reads = [];
fs.readFileSync = path => {
    reads.push(path);
    if (!Object.hasOwn(files, path)) {
        throw Object.assign(new Error('no such file'), { code: 'ENOENT' });
    }
    return JSON.stringify(files[path]);
};
fs.statSync = path => (Object.hasOwn(files, path) ? { isFile: () => true } : undefined);

try {
    const context = { parentURL, conditions: ['node', 'import'] };
    const { url, format } = resolve(specifier, context, () => ({ url: 'next' }));
    console.log(JSON.stringify({ url, format, reads }));
} catch (error) {
    console.log(JSON.stringify({ error: error.code, reads }));
}
`;

function probePaths(probeCase: PathProbe): unknown {
    writeFiles(consumer, { 'platform-paths/probe.mjs': pathProbe });
    return nodeJson(['platform-paths/probe.mjs', JSON.stringify(probeCase)]);
}

// A relative path such as package.json would read the working directory's
const workingDirectoryPackage = { 'package.json': { type: 'module' } };

const pathCases: readonly PathCase[] = [
    {
        name: 'Windows paths: PnP resolve reads package.json up to the drive root, not the working directory',
        probe: {
            windows: true,
            files: workingDirectoryPackage,
            specifier: './b.js',
            parentURL: 'file:///C:/outside/a.js'
        },
        expected: {
            url: 'file:///C:/outside/b.js',
            format: 'commonjs',
            reads: ['C:/outside/package.json', 'C:/package.json']
        }
    },
    {
        name: "Windows paths: PnP resolve reads package.json up to a UNC share's root, not the working directory",
        probe: {
            windows: true,
            files: workingDirectoryPackage,
            specifier: './b.js',
            parentURL: 'file://server/share/dir/a.js'
        },
        expected: {
            url: 'file://server/share/dir/b.js',
            format: 'commonjs',
            reads: ['//server/share/dir/package.json', '//server/share/package.json']
        }
    },
    {
        name: 'Windows paths: PnP resolve rejects a file URL without a drive, as Node does',
        probe: {
            windows: true,
            files: workingDirectoryPackage,
            specifier: './b.js',
            parentURL: 'file:///outside/a.js'
        },
        expected: { error: 'ERR_INVALID_FILE_URL_PATH', reads: [] }
    },
    {
        name: 'Windows paths: PnP resolve finds a file without an extension on a UNC share',
        probe: {
            windows: true,
            files: {
                '//server/share/project/package.json': { type: 'commonjs' },
                '//server/share/project/value.ts': ''
            },
            specifier: './value',
            parentURL: 'file://server/share/project/a.js'
        },
        expected: {
            url: 'file://server/share/project/value.ts',
            format: 'commonjs-typescript',
            reads: ['//server/share/project/package.json']
        }
    },
    {
        name: 'Windows paths: PnP resolve finds a file without an extension in a percent-encoded drive path',
        probe: {
            windows: true,
            files: {
                'C:/with space/package.json': { type: 'commonjs' },
                'C:/with space/value.ts': ''
            },
            specifier: './value',
            parentURL: 'file:///C:/with%20space/a.js'
        },
        expected: {
            url: 'file:///C:/with%20space/value.ts',
            format: 'commonjs-typescript',
            reads: ['C:/with space/package.json']
        }
    },
    {
        name: 'POSIX paths: PnP resolve keeps a first directory named like a Windows drive',
        probe: {
            windows: false,
            files: workingDirectoryPackage,
            specifier: './b.js',
            parentURL: 'file:///C:/outside/a.js'
        },
        expected: {
            url: 'file:///C:/outside/b.js',
            format: 'commonjs',
            reads: ['/C:/outside/package.json', '/C:/package.json', '/package.json']
        }
    },
    {
        name: 'POSIX paths: PnP resolve keeps backslashes in directory names',
        probe: {
            windows: false,
            files: { '/project/back\\slash/value.js': '' },
            specifier: './value',
            parentURL: 'file:///project/back%5Cslash/a.js'
        },
        expected: {
            url: 'file:///project/back%5Cslash/value.js',
            format: 'commonjs',
            reads: ['/project/back\\slash/package.json', '/project/package.json', '/package.json']
        }
    },
    {
        name: 'POSIX paths: PnP resolve rejects a file URL with a host, as Node does',
        probe: {
            windows: false,
            files: workingDirectoryPackage,
            specifier: './b.js',
            parentURL: 'file://server/share/dir/a.js'
        },
        expected: { error: 'ERR_INVALID_FILE_URL_HOST', reads: [] }
    }
];

for (const { name, probe, expected } of pathCases) {
    test(name, () => assert.deepEqual(probePaths(probe), expected));
}

test('cache hook keeps resolutions apart by directory and conditions', () => {
    writeFiles(consumer, {
        'cache/register.mjs': `import { registerHooks } from 'node:module';
import * as cache from '@snovader/node-hooks/cache';
import * as typescript from '@snovader/node-hooks/typescript';

registerHooks({ load: typescript.load });
registerHooks({ resolve: cache.resolve });
`,
        'cache/one/value.ts': "export default 'one' as string;\n",
        'cache/one/read.ts': "export { default } from './value.ts';\n",
        'cache/two/value.ts': "export default 'two' as string;\n",
        'cache/two/read.ts': "export { default } from './value.ts';\n",
        'cache/node_modules/dual/package.json': {
            name: 'dual',
            exports: { import: './esm.mjs', require: './cjs.cjs' }
        },
        'cache/node_modules/dual/esm.mjs': "export default 'import';\n",
        'cache/node_modules/dual/cjs.cjs': "module.exports = 'require';\n",
        'cache/entry.ts': `import { readFileSync } from 'fs';
import { createRequire } from 'node:module';
import imported from 'dual';
import one from './one/read.ts';
import two from './two/read.ts';

const required: string = createRequire(import.meta.url)('dual');
console.log(JSON.stringify({
    values: [one, two],
    dual: [imported, required],
    builtin: typeof readFileSync
}));
`
    });

    assert.deepEqual(nodeJson(['--import', './cache/register.mjs', 'cache/entry.ts']), {
        values: ['one', 'two'],
        dual: ['import', 'require'],
        builtin: 'function'
    });
});

test('cache hook remembers what the next hooks resolve, and leaves the hooks before it to change their answers', () => {
    // A hook that redirects a module, or a built-in, while a global names it
    const redirect = `export function resolve(specifier, context, nextResolve) {
    const { redirects } = globalThis;
    if (redirects?.[specifier] !== undefined) {
        return nextResolve(redirects[specifier], context);
    }
    return nextResolve(specifier, context);
}
`;
    const register = (order: string): string => `import { registerHooks } from 'node:module';
import * as cache from '@snovader/node-hooks/cache';
import * as typescript from '@snovader/node-hooks/typescript';
import * as redirect from './redirect.mjs';

registerHooks({ load: typescript.load });
${order}
`;

    writeFiles(consumer, {
        'cache-order/redirect.mjs': redirect,
        // The cache runs after the redirects, and remembers what they lead to
        'cache-order/cache-inside.mjs': register(
            'registerHooks({ resolve: cache.resolve });\nregisterHooks({ resolve: redirect.resolve });'
        ),
        // The cache runs first, and remembers the first answer of the redirects
        'cache-order/cache-outside.mjs': register(
            'registerHooks({ resolve: redirect.resolve });\nregisterHooks({ resolve: cache.resolve });'
        ),
        'cache-order/value.ts': "export default 'value' as string;\n",
        'cache-order/other.ts': "export default 'other' as string;\n",
        'cache-order/path.ts': "export const sep: string = 'redirected';\n",
        'cache-order/entry.ts': `const before = await import('./value.ts');
const sepBefore = (await import('node:path')).sep;
(globalThis as { redirects?: object }).redirects = {
    './value.ts': './other.ts',
    'node:path': new URL('./path.ts', import.meta.url).href
};
const after = await import('./value.ts');
const sepAfter = (await import('node:path')).sep;
console.log(JSON.stringify({
    values: [before.default, after.default],
    builtin: [sepBefore, sepAfter]
}));
`
    });

    assert.deepEqual(
        nodeJson(['--import', './cache-order/cache-inside.mjs', 'cache-order/entry.ts']),
        { values: ['value', 'other'], builtin: [sep, 'redirected'] }
    );
    assert.deepEqual(
        nodeJson(['--import', './cache-order/cache-outside.mjs', 'cache-order/entry.ts']),
        { values: ['value', 'value'], builtin: [sep, sep] }
    );
});

test("Yarn PnP projects load TypeScript, and the PnP hooks resolve packages' exports and imports", () => {
    const directory = join(sandbox, 'pnp-consumer');
    writeFiles(directory, {
        'package.json': {
            name: 'pnp-consumer',
            private: true,
            type: 'module',
            imports: { '#internal': './internal.ts' },
            dependencies: {
                '@snovader/node-hooks': `file:${tarball}`,
                dual: 'file:./dual',
                // Installed under names that differ from their package.json
                aliased: 'file:./target',
                'aliased-maps': 'npm:resolve-pkg-maps@^1.0.0',
                nameless: 'file:./nameless',
                'resolve-pkg-maps': '^1.0.0',
                // TypeScript in Yarn's zip archive, which the PnP load hook reads
                typed: 'file:./typed'
            },
            dependenciesMeta: {
                '@snovader/node-hooks': { unplugged: true }
            }
        },
        // This temporary consumer creates its own lockfile, including in CI.
        '.yarnrc.yml': 'nodeLinker: pnp\nenableTelemetry: false\nenableImmutableInstalls: false\n',
        'yarn.lock': '',
        'dual/package.json': {
            name: 'dual',
            version: '1.0.0',
            exports: { import: './esm.mjs', require: './cjs.cjs' }
        },
        'dual/esm.mjs': "export default 'import';\n",
        'dual/cjs.cjs': "module.exports = 'require';\n",
        'target/package.json': {
            name: 'target',
            version: '1.0.0',
            type: 'module',
            exports: { '.': './index.js', './feature': './feature.js' }
        },
        'target/index.js': "export default 'aliased';\n",
        'target/feature.js': "export default 'feature';\n",
        'nameless/package.json': { version: '1.0.0', type: 'module' },
        'nameless/index.js': "export default 'nameless';\n",
        'typed/package.json': {
            name: 'typed',
            version: '1.0.0',
            type: 'module',
            exports: './index.ts'
        },
        'typed/index.ts': "const typed: string = 'typed';\nexport default typed;\n",
        // Only Yarn's CommonJS runtime runs, so the hooks are imported by path
        'import-hooks.mjs': `import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

export function importHooks(name) {
    return import(pathToFileURL(require.resolve(\`@snovader/node-hooks/\${name}\`)).href);
}
`,
        'typescript.mjs': `import { registerHooks } from 'node:module';
import { importHooks } from './import-hooks.mjs';

const typescript = await importHooks('typescript');
registerHooks({ load: typescript.load });
`,
        'register.mjs': `import { registerHooks } from 'node:module';
import { importHooks } from './import-hooks.mjs';

const pnp = await importHooks('pnp');
const typescript = await importHooks('typescript');
registerHooks({ resolve: pnp.resolve, load: pnp.load });
registerHooks({ load: typescript.load });
`,
        'internal.ts':
            "const internal: string = 'internal';\nexport default internal;\n\nif (import.meta.main) {\n    console.log(JSON.stringify(internal));\n}\n",
        'main.ts': `import { createRequire } from 'node:module';
import aliased from 'aliased';
import feature from 'aliased/feature';
import { resolveExports } from 'aliased-maps';
import imported from 'dual';
import nameless from 'nameless';
import typed from 'typed';
import internal from '#internal';

const required: string = createRequire(import.meta.url)('dual');
console.log(JSON.stringify({
    dual: [imported, required],
    internal,
    aliased: [aliased, feature, typeof resolveExports],
    nameless,
    typed
}));
`
    });
    succeed(process.execPath, [YARN, 'install'], { cwd: directory });

    // Every hook resolves to its build through the exports that Yarn packed
    writeFiles(directory, {
        'entries.cjs': `const names = ${JSON.stringify(entryPoints)};
console.log(JSON.stringify(names.map(name => require.resolve(\`@snovader/node-hooks/\${name}\`))));
`
    });
    const resolved = nodeJson(['--require', './.pnp.cjs', 'entries.cjs'], {
        cwd: directory
    }) as string[];
    for (const [index, name] of entryPoints.entries()) {
        assert.match(
            resolved[index],
            new RegExp(`[\\\\/]node-hooks[\\\\/]dist[\\\\/]${name}\\.js$`, 'u')
        );
    }

    assert.equal(
        nodeJson(['--require', './.pnp.cjs', '--import', './typescript.mjs', 'internal.ts'], {
            cwd: directory
        }),
        'internal'
    );
    assert.deepEqual(
        nodeJson(['--require', './.pnp.cjs', '--import', './register.mjs', 'main.ts'], {
            cwd: directory
        }),
        {
            dual: ['import', 'require'],
            internal: 'internal',
            aliased: ['aliased', 'feature', 'function'],
            nameless: 'nameless',
            typed: 'typed'
        }
    );
});
