// Rules for tests that run on Vitest, which a configuration extends after the
// base. They see the tests and assertions imported from `vitest`, and the
// plugin runs the rest of its rules of the base's categories too.
import type { OxlintConfig } from 'oxlint';

const config = {
    plugins: ['vitest'],
    rules: {
        // Each test asserts, assertions name and call their matchers, and
        // helpers whose names start with `expect` assert
        'vitest/expect-expect': [
            'error',
            { assertFunctionNames: ['expect*', 'assert', 'assertType'] }
        ],
        'vitest/no-standalone-expect': 'error',
        'vitest/valid-expect': 'error',
        'vitest/valid-expect-in-promise': 'error',
        'vitest/require-to-throw-message': 'error',
        // `toBe` compares with Object.is, which tells -0 from 0
        'vitest/prefer-to-be': 'error',
        'vitest/prefer-to-have-length': 'error',
        // Every test runs, declared unconditionally, with a valid title, and
        // describe blocks declare them in functions written in place
        'vitest/no-focused-tests': 'error',
        'vitest/no-disabled-tests': 'error',
        'vitest/warn-todo': 'error',
        'vitest/no-conditional-tests': 'error',
        'vitest/valid-title': 'error',
        'vitest/valid-describe-callback': 'error',
        // Mocks are typed, and hoisted from where they're written
        'vitest/require-mock-type-parameters': 'error',
        'vitest/hoisted-apis-on-top': 'error'
    }
} satisfies OxlintConfig;

export default config;
