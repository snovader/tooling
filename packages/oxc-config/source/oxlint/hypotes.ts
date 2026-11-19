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
        // Tests, which a helper whose name starts with `expect` asserts for
        // too
        'hypotes/no-focused-tests': 'error',
        'hypotes/no-disabled-tests': 'error',
        'hypotes/warn-todo': 'error',
        'hypotes/no-conditional-tests': 'error',
        'hypotes/valid-title': 'error',
        'hypotes/valid-describe-callback': 'error',
        'hypotes/expect-expect': 'error',
        'hypotes/no-standalone-expect': 'error',
        'hypotes/valid-expect': 'error',
        'hypotes/valid-expect-in-promise': 'error',
        'hypotes/require-to-throw-message': 'error',
        // `toBe` compares with Object.is, which tells -0 from 0
        'hypotes/prefer-to-be': 'error',
        'hypotes/prefer-to-have-length': 'error',
        'hypotes/hoisted-apis-on-top': 'error',
        'hypotes/require-mock-type-parameters': 'error'
    }
} satisfies OxlintConfig;

export default config;
