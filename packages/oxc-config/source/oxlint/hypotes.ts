// Rules for tests that run on hypotes, which a configuration extends after the
// base. oxlint's own rules for Vitest see only what is imported from `vitest`,
// so hypotes has rules for the tests declared through it.
import { fileURLToPath } from 'node:url';
import type { OxlintConfig } from 'oxlint';

/**
 * hypotes' plugin, by its path, which oxlint loads under Yarn Plug'n'Play only
 * once Yarn has unpacked hypotes
 */
const PLUGIN = fileURLToPath(import.meta.resolve('hypotes/oxlint'));

const config = {
    jsPlugins: [PLUGIN],
    rules: {
        // Each test asserts, assertions name and call their matchers, and
        // helpers whose names start with `expect` assert
        'hypotes/expect-expect': 'error',
        'hypotes/no-standalone-expect': 'error',
        'hypotes/valid-expect': 'error',
        'hypotes/valid-expect-in-promise': 'error',
        'hypotes/require-to-throw-message': 'error',
        // `toBe` compares with Object.is, which tells -0 from 0
        'hypotes/prefer-to-be': 'error',
        'hypotes/prefer-to-have-length': 'error',
        // Every test runs, declared unconditionally, with a valid title, and
        // describe blocks declare them in functions written in place
        'hypotes/no-focused-tests': 'error',
        'hypotes/no-disabled-tests': 'error',
        'hypotes/warn-todo': 'error',
        'hypotes/no-conditional-tests': 'error',
        'hypotes/valid-title': 'error',
        'hypotes/valid-describe-callback': 'error',
        // Mocks are typed, and hoisted from where they're written
        'hypotes/require-mock-type-parameters': 'error',
        'hypotes/hoisted-apis-on-top': 'error'
    }
} satisfies OxlintConfig;

export default config;
