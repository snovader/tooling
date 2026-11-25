import { defineConfig } from 'oxfmt';
import oxfmt from '@snovader/oxc-config/oxfmt';

export default defineConfig({
    ...oxfmt,
    ignorePatterns: [
        '.yarn',
        'packages/*/dist',
        // Yarn writes these in a format of its own
        '**/package.json'
    ],
    sortImports: {
        ...oxfmt.sortImports,
        internalPattern: ['@snovader/']
    }
});
