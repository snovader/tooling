import { defineConfig } from 'oxlint';
import oxlint from '@snovader/oxc-config/oxlint';

export default defineConfig({
    extends: [oxlint],
    ignorePatterns: ['.yarn', 'packages/*/dist'],
    overrides: [
        {
            // node:test's `describe`, `it` and `test` return promises, which
            // its runner awaits, and which RuleTester declares its cases with
            files: ['test/**/*.test.ts'],
            rules: {
                'typescript/no-floating-promises': 'off',
                'typescript/no-misused-promises': 'off'
            }
        },
        {
            // oxlint and oxfmt read configurations, and oxlint plugins, from
            // default exports, which the package's modules pass on
            files: ['packages/oxc-config/source/**'],
            rules: {
                'import/no-default-export': 'off'
            }
        }
    ]
});
