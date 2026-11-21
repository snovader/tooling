// Temporary projects that install the packed packages, as a consumer would,
// and the commands that the tests run in them
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The repository, whose tools the tests run */
export const ROOT = join(import.meta.dirname, '..');

/** The checked-in Yarn release, which packs the packages */
export const YARN = join(ROOT, '.yarn/releases/yarn-4.18.1.cjs');

export interface Options {
    readonly cwd: string;
    readonly input?: string;
    /** The whole environment, as spawnSync takes it: process.env by default */
    readonly env?: NodeJS.ProcessEnv;
}

export interface Result {
    readonly status: number | null;
    readonly stdout: string;
    readonly stderr: string;
}

/** Runs a command to its end, which a test expects to finish on its own */
export function run(
    command: string,
    args: readonly string[],
    options: Options
): Result {
    const result = spawnSync(command, args, {
        cwd: options.cwd,
        encoding: 'utf8',
        env: options.env,
        input: options.input
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null, result.stderr);

    return result;
}

/** Runs a command that has to succeed, and returns what it prints */
export function succeed(
    command: string,
    args: readonly string[],
    options: Options
): string {
    const result = run(command, args, options);
    assert.equal(result.status, 0, result.stdout + result.stderr);

    return result.stdout;
}

export function writeJson(path: string, value: unknown): void {
    writeFileSync(path, `${JSON.stringify(value, null, 4)}\n`);
}

/** A directory for a test file's consumers, which it removes after */
export function createSandbox(): string {
    return mkdtempSync(join(tmpdir(), 'snovader-tooling-'));
}

/**
 * Packs a workspace with Yarn, which runs its `prepack` script and replaces
 * its exports with those of its publishConfig, and returns the tarball's path
 */
export function pack(workspace: string, sandbox: string): string {
    const tarball = join(sandbox, `${workspace.replaceAll(/\W+/g, '-')}.tgz`);
    succeed(
        process.execPath,
        [YARN, 'workspace', workspace, 'pack', '--out', tarball],
        { cwd: ROOT }
    );

    return tarball;
}

/**
 * Creates a project that installs packages with npm into `node_modules`,
 * leaving out their peer dependencies, which the tests take from the
 * repository instead
 */
export function installNodeModules(
    directory: string,
    packages: readonly string[]
): void {
    mkdirSync(directory);
    writeJson(join(directory, 'package.json'), {
        private: true,
        type: 'module'
    });
    succeed(
        'npm',
        [
            'install',
            '--ignore-scripts',
            '--no-audit',
            '--no-fund',
            '--package-lock=false',
            '--legacy-peer-deps',
            ...packages
        ],
        { cwd: directory }
    );
}

/** Creates a project that installs its dependencies with Yarn Plug'n'Play */
export function installPnp(
    directory: string,
    manifest: Readonly<Record<string, unknown>>,
    settings: readonly string[] = []
): void {
    mkdirSync(directory);
    writeJson(join(directory, 'package.json'), {
        name: 'pnp-consumer',
        private: true,
        type: 'module',
        ...manifest
    });
    writeFileSync(join(directory, 'yarn.lock'), '');
    writeFileSync(
        join(directory, '.yarnrc.yml'),
        [
            'nodeLinker: pnp',
            'enableTelemetry: false',
            // This temporary consumer creates its own lockfile, including in CI
            'enableImmutableInstalls: false',
            ...settings,
            ''
        ].join('\n')
    );
    succeed(process.execPath, [YARN, 'install'], { cwd: directory });
}
