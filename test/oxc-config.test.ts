import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { after, before, describe, it, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { RuleTester } from 'oxlint/plugins-dev';
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
    type Options
} from './consumers.ts';

type Rule = Parameters<RuleTester['run']>[1];

interface Diagnostic {
    readonly code?: string;
    readonly message: string;
}

const OXFMT = join(ROOT, 'node_modules/oxfmt/bin/oxfmt');
const OXLINT = join(ROOT, 'node_modules/oxlint/bin/oxlint');

/** The message of the plugin's rule */
const SORT_MESSAGE =
    /^Expected "[^"]+" before "[^"]+": names in lower case, then upper case, then types, each in natural order$/u;

const sandbox = createSandbox();
const consumer = join(sandbox, 'consumer');
const tarball = pack('@snovader/oxc-config', sandbox);

// The consumer installs the package, and hypotes for its preset, and runs
// the repository's oxfmt, oxlint and tsgolint
installNodeModules(consumer, [tarball, 'hypotes@0.1.0']);
const consumerOptions: Options = {
    cwd: consumer,
    env: { ...process.env, OXLINT_TSGOLINT_PATH: join(ROOT, 'node_modules/.bin/tsgolint') }
};
writeJson(join(consumer, 'tsconfig.json'), {
    compilerOptions: {
        strict: true,
        module: 'nodenext',
        target: 'esnext',
        noEmit: true,
        allowImportingTsExtensions: true,
        jsx: 'react-jsx',
        jsxImportSource: 'preact',
        skipLibCheck: true,
        types: []
    }
});
writeFileSync(
    join(consumer, 'oxfmt.config.ts'),
    "import oxfmt from '@snovader/oxc-config/oxfmt';\n\nexport default { ...oxfmt };\n"
);

after(() => rmSync(sandbox, { recursive: true, force: true }));

/** Formats a file's text as the packed configuration does */
function format(filename: string, source: string, cwd: string = consumer): string {
    return succeed(process.execPath, [OXFMT, '--stdin-filepath', filename], {
        cwd,
        input: source
    });
}

/** Writes an `oxlint.config.ts` that extends the base and the named presets */
function configureOxlint(directory: string, presets: readonly string[] = []): void {
    const modules = ['oxlint', ...presets.map(preset => `oxlint/${preset}`)];
    const imports = modules.map(
        (module, i) => `import config${i} from '@snovader/oxc-config/${module}';\n`
    );
    const configs = modules.map((_, i) => `config${i}`).join(', ');
    writeFileSync(
        join(directory, 'oxlint.config.ts'),
        `${imports.join('')}\nexport default { extends: [${configs}], ignorePatterns: ['.yarn', '.pnp.*'] };\n`
    );
}

/** Lints a file in a consumer, and returns oxlint's diagnostics */
function lintIn(
    options: Options,
    command: readonly string[],
    filename: string,
    source: string,
    args: readonly string[] = []
): Diagnostic[] {
    writeFileSync(join(options.cwd, filename), source);
    const result = run(
        command[0],
        [...command.slice(1), '--format=json', ...args, filename],
        options
    );
    // oxlint prints why it couldn't lint, such as a configuration that it
    // couldn't load, rather than diagnostics
    assert.ok(result.stdout.startsWith('{'), result.stdout + result.stderr);

    return (JSON.parse(result.stdout) as { diagnostics: Diagnostic[] }).diagnostics;
}

function lint(filename: string, source: string, args: readonly string[] = []): Diagnostic[] {
    return lintIn(consumerOptions, [process.execPath, OXLINT], filename, source, args);
}

/** The rules that reported each diagnostic */
function codes(diagnostics: readonly Diagnostic[]): string[] {
    return diagnostics.map(diagnostic => diagnostic.code ?? diagnostic.message);
}

function codesOf(diagnostics: readonly Diagnostic[], code: string): string[] {
    return codes(diagnostics).filter(found => found === code);
}

/** The rules of a plugin that reported a file, in order */
function reportedBy(plugin: string, filename: string, source: string): string[] {
    return codes(lint(filename, source))
        .filter(code => code.startsWith(`${plugin}(`))
        .toSorted();
}

describe('packed oxfmt configuration', () => {
    it('indents by four spaces, with single quotes, semicolons, and no trailing commas', () => {
        assert.equal(
            format(
                'example.ts',
                'export const greet = (name:string)=>{return "hello "+name}\nexport const double = (value:number) => value*2\n'
            ),
            "export const greet = (name: string) => {\n    return 'hello ' + name;\n};\nexport const double = (value: number) => value * 2;\n"
        );
        assert.equal(
            format(
                'example.ts',
                "export const names = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta'];\n"
            ),
            "export const names = [\n    'alpha',\n    'beta',\n    'gamma',\n    'delta',\n    'epsilon',\n    'zeta',\n    'eta'\n];\n"
        );
        assert.equal(
            format('example.ts', 'export const double = (value) => value * 2;\n'),
            'export const double = value => value * 2;\n'
        );
    });

    it("sorts imports: Node's modules, packages, then relative paths, nearest last", () => {
        assert.equal(
            format(
                'example.ts',
                "import { local } from './local.ts';\nimport { parent } from '../parent.ts';\nimport { external } from 'external';\nimport { join } from 'node:path';\nimport { own } from '#own';\n\nexport const all = [local, parent, external, join, own];\n"
            ),
            "import { join } from 'node:path';\nimport { external } from 'external';\nimport { own } from '#own';\nimport { parent } from '../parent.ts';\nimport { local } from './local.ts';\n\nexport const all = [local, parent, external, join, own];\n"
        );
    });

    it('wraps at 80 columns, tests at 100, and TypeScript configurations at 60', () => {
        const call =
            'export const result = combine(firstArgument, secondArgument, thirdArgument, fourth);\n';
        assert.equal(
            format('example.ts', call),
            'export const result = combine(\n    firstArgument,\n    secondArgument,\n    thirdArgument,\n    fourth\n);\n'
        );
        assert.equal(format('example.test.ts', call), call);
        assert.equal(format('example.test.tsx', call), call);
        assert.equal(
            format(
                'tsconfig.json',
                '{ "compilerOptions": { "lib": ["DOM", "DOM.Iterable", "ESNext", "WebWorker"] } }\n'
            ),
            '{\n    "compilerOptions": {\n        "lib": [\n            "DOM",\n            "DOM.Iterable",\n            "ESNext",\n            "WebWorker"\n        ]\n    }\n}\n'
        );
    });

    it('indents YAML by two spaces, with double quotes', () => {
        assert.equal(
            format('example.yml', "jobs:\n    check:\n        steps:\n            - run: 'test'\n"),
            'jobs:\n  check:\n    steps:\n      - run: "test"\n'
        );
    });

    it('quotes JSX attributes with double quotes', () => {
        assert.equal(
            format('example.tsx', "export const link = <a class='link' href='/'>Home</a>;\n"),
            'export const link = (\n    <a class="link" href="/">\n        Home\n    </a>\n);\n'
        );
    });
});

describe('packed oxlint base configuration', () => {
    before(() => configureOxlint(consumer));

    // The examples of the GritQL rule useArraySimple, which
    // `typescript/array-type` replaces
    it('reports and fixes arrays of simple and complex element types', () => {
        const diagnostics = lint(
            'example.ts',
            'export type Names = Array<string>;\nexport type Values = (string | number)[];\nexport type Keys = ReadonlyArray<string>;\nexport type Entries = readonly (string | number)[];\nexport type Matrix = Array<number>[];\n'
        );
        assert.equal(codesOf(diagnostics, 'typescript(array-type)').length, 5);

        lint('example.ts', readFileSync(join(consumer, 'example.ts'), 'utf8'), ['--fix']);
        assert.equal(
            readFileSync(join(consumer, 'example.ts'), 'utf8'),
            'export type Names = string[];\nexport type Values = Array<string | number>;\nexport type Keys = readonly string[];\nexport type Entries = ReadonlyArray<string | number>;\nexport type Matrix = number[][];\n'
        );
    });

    it('accepts readonly, nested, generic, and heritage array types', () => {
        const diagnostics = lint(
            'example.ts',
            'export type Names = readonly string[];\nexport type Matrix = number[][];\nexport type Pairs = ReadonlyArray<[string, number]>;\nexport interface NamesList extends Array<string> {\n    readonly label: string;\n}\n'
        );
        assert.deepEqual(codesOf(diagnostics, 'typescript(array-type)'), []);
    });

    // The examples of the GritQL rule useExplicitReturnType, which
    // `typescript/explicit-function-return-type` replaces
    it('reports declarations, getters, methods, and function-valued variables', () => {
        const diagnostics = lint(
            'example.ts',
            'export function answer() { return 42; }\nexport const value = () => 42;\nexport class Example {\n    get answer() { return 42; }\n    method() { return 42; }\n}\nexport default function () { return 42; }\n'
        );
        assert.equal(codesOf(diagnostics, 'typescript(explicit-function-return-type)').length, 5);
    });

    it('accepts annotated, contextual, callback, and self-typed functions', () => {
        const diagnostics = lint(
            'example.ts',
            'export function answer(): number { return 42; }\nexport const typed: () => number = () => 42;\nexport const object: { value(): number } = { value() { return 42; } };\nexport const values = [1, 2].map(value => value * 2);\nexport const literal = () => 42 as const;\nexport const factory = () => (): number => 42;\n'
        );
        assert.deepEqual(codesOf(diagnostics, 'typescript(explicit-function-return-type)'), []);
    });

    it('unlike the GritQL rule, reports overrides and accepts members of untyped objects', () => {
        const diagnostics = lint(
            'example.ts',
            'export class Base {\n    value(): number { return 1; }\n}\nexport class Derived extends Base {\n    override value() { return 2; }\n}\nexport const object = { method() { return 1; }, get getter() { return 1; }, property: () => 1 };\n'
        );
        assert.equal(codesOf(diagnostics, 'typescript(explicit-function-return-type)').length, 1);
    });

    it('accepts functions without return types in JavaScript', () => {
        const diagnostics = lint('example.js', 'export function answer() { return 42; }\n');
        assert.deepEqual(codesOf(diagnostics, 'typescript(explicit-function-return-type)'), []);
    });

    it('sorts named imports with the bundled plugin', () => {
        writeFileSync(
            join(consumer, 'names.ts'),
            'export const lower = 1;\nexport const Upper = 2;\n'
        );
        const diagnostics = lint(
            'example.ts',
            "import { Upper, lower } from './names.ts';\n\nexport const sum: number = lower + Upper;\n"
        );
        assert.deepEqual(codes(diagnostics), ['snovader(sort-named-imports)']);
        assert.match(diagnostics[0].message, SORT_MESSAGE);

        lint('example.ts', readFileSync(join(consumer, 'example.ts'), 'utf8'), ['--fix']);
        assert.match(
            readFileSync(join(consumer, 'example.ts'), 'utf8'),
            /^import \{ lower, Upper \} from '\.\/names\.ts';/u
        );
    });

    it('reports and merges a type import beside a value import from the same module', () => {
        writeFileSync(
            join(consumer, 'shapes.ts'),
            'export const unit = 1;\nexport interface Shape {\n    readonly width: number;\n}\n'
        );
        const diagnostics = lint(
            'example.ts',
            "import { unit } from './shapes.ts';\nimport type { Shape } from './shapes.ts';\n\nexport const width = (shape: Shape): number => shape.width * unit;\n"
        );
        assert.deepEqual(codes(diagnostics), ['import(no-duplicates)']);

        // oxlint's fix leaves out the space before `type`, which oxfmt adds
        lint('example.ts', readFileSync(join(consumer, 'example.ts'), 'utf8'), ['--fix']);
        assert.equal(
            format('example.ts', readFileSync(join(consumer, 'example.ts'), 'utf8')),
            "import { unit, type Shape } from './shapes.ts';\n\nexport const width = (shape: Shape): number => shape.width * unit;\n"
        );
    });

    it('keeps an import of types only as import type', () => {
        const source =
            "import type { Shape } from './shapes.ts';\n\nexport const width = (shape: Shape): number => shape.width;\n";
        assert.deepEqual(codes(lint('example.ts', source)), []);

        assert.deepEqual(codes(lint('example.ts', source.replace('type {', '{ type'))), [
            'typescript(no-import-type-side-effects)'
        ]);
    });

    it('runs type-aware rules through tsgolint', () => {
        const diagnostics = lint(
            'example.ts',
            'async function later(): Promise<void> {\n    await Promise.resolve();\n}\n\nlater();\n'
        );
        assert.ok(codes(diagnostics).includes('typescript(no-floating-promises)'));
    });

    it('reports directives that disable nothing', () => {
        const diagnostics = lint(
            'example.ts',
            '// oxlint-disable-next-line eslint/no-var\nexport const value = 1;\n'
        );
        assert.equal(diagnostics.length, 1);
        assert.match(diagnostics[0].message, /Unused oxlint-disable directive/u);
    });

    it('lets configurations export defaults', () => {
        assert.deepEqual(codes(lint('example.config.ts', 'export default {};\n')), []);
        assert.deepEqual(codes(lint('example.ts', 'export default {};\n')), [
            'import(no-default-export)'
        ]);
    });

    it('lets tests assign matchers typed any, which other files may not', () => {
        const source = "export const expected = { name: 'example', size: JSON.parse('1') };\n";
        const code = 'typescript(no-unsafe-assignment)';
        assert.deepEqual(codesOf(lint('example.test.ts', source), code), []);
        assert.deepEqual(codesOf(lint('example.ts', source), code), [code]);
    });

    it('accepts == null and != null for a missing value, and no other loose comparison', () => {
        assert.deepEqual(
            reportedBy(
                'eslint',
                'example.ts',
                'export function isMissing(value: string | null | undefined): boolean {\n    return value == null;\n}\n\nexport function isPresent(value: string | null | undefined): boolean {\n    return value != null;\n}\n'
            ),
            []
        );
        assert.deepEqual(
            reportedBy(
                'eslint',
                'example.ts',
                'export function isZero(value: number | string): boolean {\n    return value == 0;\n}\n\nexport function isUnset(value: string | undefined): boolean {\n    return value == undefined;\n}\n'
            ),
            ['eslint(eqeqeq)', 'eslint(eqeqeq)']
        );
    });

    it('accepts nullable primitives and any as conditions, but not objects', () => {
        assert.deepEqual(
            reportedBy(
                'typescript',
                'example.ts',
                "export function describe(\n    name: string | undefined,\n    count: number | null,\n    enabled?: boolean\n): string {\n    const parsed: { readonly label?: string } = JSON.parse('{}');\n    if (!name || !count || !enabled || !JSON.parse('0')) {\n        return 'none';\n    }\n\n    return parsed.label ? name : 'unlabelled';\n}\n"
            ).filter(code => code !== 'typescript(no-unsafe-assignment)'),
            []
        );
        assert.deepEqual(
            reportedBy(
                'typescript',
                'example.ts',
                "export function describe(options: { readonly name: string }): string {\n    return options ? options.name : 'none';\n}\n"
            ),
            ['typescript(strict-boolean-expressions)']
        );
    });

    it('still reports || on a nullable value, where ?? tells an empty one from a missing one', () => {
        assert.deepEqual(
            reportedBy(
                'typescript',
                'example.ts',
                "export function label(name: string | undefined): string {\n    return name || 'none';\n}\n"
            ),
            ['typescript(prefer-nullish-coalescing)']
        );
    });

    it('accepts sorting and reversing a copy in place, and arrays allocated at their length', () => {
        assert.deepEqual(
            reportedBy(
                'unicorn',
                'example.ts',
                'export function sorted(values: Iterable<number>): Float64Array {\n    return Float64Array.from(values).sort();\n}\n\nexport function reversed(values: readonly string[]): string[] {\n    return [...values].reverse();\n}\n\nexport function squares(length: number): number[] {\n    const result = new Array<number>(length);\n    for (let i = 0; i < length; i++) {\n        result[i] = i * i;\n    }\n\n    return result;\n}\n'
            ),
            []
        );
    });

    it('accepts indexed access, UTF-16 code units, and conversions to int32', () => {
        assert.deepEqual(
            reportedBy(
                'unicorn',
                'example.ts',
                'export function last(values: readonly number[]): number {\n    return values[values.length - 1];\n}\n\nexport function unit(text: string, index: number): number {\n    return text.charCodeAt(index);\n}\n\nexport function letter(unit: number): string {\n    return String.fromCharCode(unit);\n}\n\nexport function toInt32(value: number): number {\n    return value | 0;\n}\n'
            ),
            []
        );
    });

    it('asks for the u flag only where a pattern needs it', () => {
        assert.deepEqual(
            reportedBy('eslint', 'example.ts', 'export const DIGITS = /^[0-9]+$/;\n'),
            []
        );
        assert.deepEqual(
            reportedBy('eslint', 'example.ts', 'export const THUMBS = /^[\u{1F44D}]$/;\n'),
            ['eslint(no-misleading-character-class)']
        );
    });

    it('accepts an await in a loop', () => {
        assert.deepEqual(
            reportedBy(
                'eslint',
                'example.ts',
                'export async function runInOrder(\n    steps: ReadonlyArray<() => Promise<void>>\n): Promise<void> {\n    for (const step of steps) {\n        await step();\n    }\n}\n'
            ),
            []
        );
    });

    it('reports an async function that awaits nothing once, with type information', () => {
        const source =
            'export async function answer(): Promise<number> {\n    return 42;\n}\n\nexport async function later(): Promise<number> {\n    return Promise.resolve(42);\n}\n';
        assert.deepEqual(reportedBy('eslint', 'example.ts', source), []);
        assert.deepEqual(reportedBy('typescript', 'example.ts', source), [
            'typescript(require-await)'
        ]);
    });

    it('names files in kebab-case, whatever they export', () => {
        const source = 'export class ExampleModule {}\n';
        assert.deepEqual(codesOf(lint('exampleModule.ts', source), 'unicorn(filename-case)'), [
            'unicorn(filename-case)'
        ]);
        assert.deepEqual(codesOf(lint('ExampleModule.ts', source), 'unicorn(filename-case)'), [
            'unicorn(filename-case)'
        ]);
        assert.deepEqual(codesOf(lint('example-module.ts', source), 'unicorn(filename-case)'), []);
        assert.deepEqual(
            codesOf(lint('example-module.test.ts', source), 'unicorn(filename-case)'),
            []
        );
    });
});

// The plugin of the packed package, which consumers load through the base
const plugin = (await import(
    pathToFileURL(
        createRequire(join(consumer, 'package.json')).resolve('@snovader/oxc-config/oxlint/plugin')
    ).href
)) as { default: { meta: { name: string }; rules: Record<string, Rule> } };

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
    languageOptions: { parserOptions: { lang: 'ts' } }
});

tester.run('sort-named-imports', plugin.default.rules['sort-named-imports'], {
    valid: [
        "import { alpha, beta, Alpha, SIZEOF_8, SIZEOF_16, _private, type Zed } from 'a';",
        "import Default, { a, b } from 'a';",
        "import * as all from 'a';",
        "import type { Reader, Writer } from 'a';",
        "import { a as y, b as z } from 'a';",
        "import {\n    a,\n    // a comment\n    B\n} from 'a';"
    ],
    invalid: [
        {
            name: 'names in lower case come before names in upper case',
            code: "import { Upper, lower } from 'a';",
            output: "import { lower, Upper } from 'a';",
            errors: [{ message: SORT_MESSAGE }]
        },
        {
            name: 'types come last',
            code: "import { type Zed, Alpha, alpha } from 'a';",
            output: "import { alpha, Alpha, type Zed } from 'a';",
            errors: [{ message: SORT_MESSAGE }]
        },
        {
            name: 'numbers are in natural order',
            code: "import { SIZEOF_16, SIZEOF_8 } from 'a';",
            output: "import { SIZEOF_8, SIZEOF_16 } from 'a';",
            errors: [{ message: SORT_MESSAGE }]
        },
        {
            name: 'names of a type import are in natural order',
            code: "import type { Writer, Reader } from 'a';",
            output: "import type { Reader, Writer } from 'a';",
            errors: [{ message: SORT_MESSAGE }]
        },
        {
            name: 'aliases are sorted by their local names',
            code: "import { a as z, b as y } from 'a';",
            output: "import { b as y, a as z } from 'a';",
            errors: [{ message: SORT_MESSAGE }]
        },
        {
            name: 'names on several lines keep their lines',
            code: "import Default, {\n    beta,\n    alpha\n} from 'a';",
            output: "import Default, {\n    alpha,\n    beta\n} from 'a';",
            errors: [{ message: SORT_MESSAGE }]
        },
        {
            name: 'names with comments between them are reported but not moved',
            code: "import {\n    B,\n    // a comment\n    a\n} from 'a';",
            output: null,
            errors: [{ message: SORT_MESSAGE }]
        }
    ]
});

test('the packed plugin names its rules after the package', () => {
    assert.equal(plugin.default.meta.name, 'snovader');
});

describe('packed oxlint presets', () => {
    it("Vitest's runs oxlint's rules for tests, with helpers that start with expect", () => {
        configureOxlint(consumer, ['vitest']);
        const diagnostics = lint(
            'example.test.ts',
            "import { expect, it } from 'vitest';\n\nfunction expectEven(value: number): void {\n    expect(value % 2).toBe(0);\n}\n\nit.only('uses a helper', () => {\n    expectEven(2);\n});\nit('checks a length', () => {\n    expect([1].length).toBe(1);\n});\n"
        );
        const found = codes(diagnostics).filter(code => code.startsWith('vitest('));
        assert.deepEqual(found.toSorted(), [
            'vitest(no-focused-tests)',
            'vitest(prefer-to-have-length)'
        ]);
    });

    it("Vitest's accepts a mock that takes its type from its implementation", () => {
        configureOxlint(consumer, ['vitest']);
        const diagnostics = lint(
            'example.test.ts',
            "import { expect, it, vi } from 'vitest';\n\nit('doubles', () => {\n    const double = vi.fn((value: number) => value * 2);\n    const callback = vi.fn();\n    callback(double(2));\n\n    expect(double).toHaveBeenCalledWith(2);\n});\n"
        );
        assert.deepEqual(
            codes(diagnostics).filter(code => code.startsWith('vitest(')),
            []
        );
    });

    it("hypotes' loads hypotes' plugin and runs its rules for tests", () => {
        configureOxlint(consumer, ['hypotes']);
        const diagnostics = lint(
            'example.test.ts',
            "import { expect, it } from 'hypotes';\n\nfunction expectEven(value: number): void {\n    expect(value % 2).toBe(0);\n}\n\nit.only('uses a helper', () => {\n    expectEven(2);\n});\nit('checks a length', () => {\n    expect([1].length).toBe(1);\n});\n"
        );
        const found = codes(diagnostics).filter(code => code.startsWith('hypotes('));
        assert.deepEqual(found.toSorted(), [
            'hypotes(no-focused-tests)',
            'hypotes(prefer-to-have-length)'
        ]);
    });

    it("Preact's checks hooks, keys, and self-closing elements", () => {
        configureOxlint(consumer, ['preact']);
        const diagnostics = lint(
            'example.tsx',
            "import { useEffect, useState } from 'preact/hooks';\n\nexport function Items(props: { readonly items: readonly string[]; readonly open: boolean }): unknown {\n    if (props.open) {\n        useState(0);\n    }\n    const [count] = useState(0);\n    useEffect(() => {\n        console.log(count);\n    }, []);\n\n    return (\n        <ul>\n            {props.items.map(item => (\n                <li>{item}</li>\n            ))}\n            <li></li>\n        </ul>\n    );\n}\n"
        );
        const found = codes(diagnostics).filter(code => code.startsWith('react'));
        // React's own rule for hooks reports a conditional call too
        assert.deepEqual(found.toSorted(), [
            'react(hooks)',
            'react(jsx-key)',
            'react(self-closing-comp)',
            'react-hooks(exhaustive-deps)',
            'react-hooks(rules-of-hooks)'
        ]);
    });

    it("Preact's accepts signals that hooks list, and writes to their values", () => {
        configureOxlint(consumer, ['preact']);
        const diagnostics = lint(
            'example.tsx',
            "import { useComputed, useSignal } from '@preact/signals';\nimport { useCallback, useEffect, useMemo } from 'preact/hooks';\n\nexport function Location(): unknown {\n    const url = useSignal('/');\n    const path = useComputed(() => url.value.length);\n    const route = useCallback(\n        (next: string): void => {\n            url.value = next;\n        },\n        [url]\n    );\n    useEffect(() => {\n        route('/home');\n    }, [route]);\n    const value = useMemo(() => ({ path, route }), [path, route]);\n\n    return <div class=\"location\">{value.path}</div>;\n}\n"
        );
        assert.deepEqual(
            codes(diagnostics).filter(code => code.startsWith('react')),
            []
        );
    });

    it("Preact's can't tell that signals stay the same, so reports those that hooks leave out", () => {
        configureOxlint(consumer, ['preact']);
        const diagnostics = lint(
            'example.tsx',
            "import { useComputed, useSignal } from '@preact/signals';\nimport { useEffect, useMemo } from 'preact/hooks';\n\nexport function Location(): unknown {\n    const url = useSignal('/');\n    const path = useComputed(() => url.value.length);\n    useEffect(() => {\n        console.log(url.value);\n    }, []);\n    const value = useMemo(() => ({ path }), []);\n\n    return <div>{value.path}</div>;\n}\n"
        );
        assert.deepEqual(
            codes(diagnostics).filter(code => code.startsWith('react')),
            ['react-hooks(exhaustive-deps)', 'react-hooks(exhaustive-deps)']
        );
    });
});

describe('packed configurations under Yarn PnP', () => {
    const directory = join(sandbox, 'pnp-consumer');
    const options: Options = { cwd: directory };
    const yarnRun = [process.execPath, YARN, 'oxlint'];

    before(() => {
        installPnp(
            directory,
            {
                dependencies: {
                    '@snovader/oxc-config': `file:${tarball}`,
                    hypotes: '0.1.0',
                    oxfmt: '^0.79.0',
                    oxlint: '^1.94.0',
                    'oxlint-tsgolint': '^7.0.2007'
                },
                // oxlint loads hypotes' plugin by its path, which has to be on
                // disk rather than in a zip archive
                dependenciesMeta: { hypotes: { unplugged: true } }
            },
            // hypotes 0.1.0 is younger than Yarn's default minimal age
            ['npmPreapprovedPackages:', '  - hypotes']
        );
        writeFileSync(
            join(directory, 'tsconfig.json'),
            '{ "compilerOptions": { "strict": true, "module": "nodenext", "noEmit": true, "allowImportingTsExtensions": true, "types": [] } }\n'
        );
        writeFileSync(
            join(directory, 'names.ts'),
            'export const lower = 1;\nexport const Upper = 2;\n'
        );
    });

    it('unplugs the package, as its preferUnplugged asks, without the consumer asking', () => {
        const unplugged = readdirSync(join(directory, '.yarn/unplugged')).filter(name =>
            name.startsWith('@snovader-oxc-config-')
        );
        assert.equal(unplugged.length, 1);
        assert.ok(
            existsSync(
                join(
                    directory,
                    '.yarn/unplugged',
                    unplugged[0],
                    'node_modules/@snovader/oxc-config/dist/oxlint/plugin.js'
                )
            )
        );
    });

    it('loads the bundled plugin and runs type-aware rules', () => {
        configureOxlint(directory);
        const diagnostics = lintIn(
            options,
            yarnRun,
            'example.ts',
            "import { Upper, lower } from './names.ts';\n\nexport const sum: number = lower + Upper;\n\nasync function later(): Promise<void> {\n    await Promise.resolve();\n}\n\nlater();\n"
        );
        assert.ok(codes(diagnostics).includes('snovader(sort-named-imports)'));
        assert.ok(codes(diagnostics).includes('typescript(no-floating-promises)'));
    });

    it("loads hypotes' plugin once the consumer unplugs hypotes", () => {
        configureOxlint(directory, ['hypotes']);
        const diagnostics = lintIn(
            options,
            yarnRun,
            'example.test.ts',
            "import { it } from 'hypotes';\n\nit.only('runs alone', () => {});\n"
        );
        assert.ok(codes(diagnostics).includes('hypotes(no-focused-tests)'));
    });

    it('imports the oxfmt configuration', () => {
        writeFileSync(
            join(directory, 'oxfmt.config.ts'),
            "import oxfmt from '@snovader/oxc-config/oxfmt';\n\nexport default { ...oxfmt };\n"
        );
        assert.equal(
            succeed(process.execPath, [YARN, 'oxfmt', '--stdin-filepath', 'example.ts'], {
                cwd: directory,
                input: 'export const greet = (name)=>"hello "+name\n'
            }),
            "export const greet = name => 'hello ' + name;\n"
        );
    });

    it("can't load the plugin from Yarn's zip archive, which preferUnplugged avoids", () => {
        const packed = join(sandbox, 'pnp-packed');
        installPnp(packed, {
            dependencies: {
                '@snovader/oxc-config': `file:${tarball}`,
                oxlint: '^1.94.0',
                'oxlint-tsgolint': '^7.0.2007'
            },
            dependenciesMeta: { '@snovader/oxc-config': { unplugged: false } }
        });
        configureOxlint(packed);
        writeFileSync(join(packed, 'example.ts'), 'export const value: number = 1;\n');
        const result = run(process.execPath, [YARN, 'oxlint', 'example.ts'], { cwd: packed });
        assert.notEqual(result.status, 0);
        assert.match(result.stdout + result.stderr, /Failed to load JS plugin/u);
    });
});
