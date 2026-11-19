// Formatting for oxfmt, which has no `extends`: a project's `oxfmt.config.ts`
// spreads this into its own configuration, and adds the paths that it ignores
// and the names that it imports itself by.
import type { OxfmtConfig } from 'oxfmt';

const config = {
    endOfLine: 'lf',
    tabWidth: 4,
    printWidth: 80,
    singleQuote: true,
    // Attributes in double quotes, as HTML writes them
    jsxSingleQuote: false,
    quoteProps: 'as-needed',
    trailingComma: 'none',
    semi: true,
    arrowParens: 'avoid',
    bracketSpacing: true,
    bracketSameLine: false,
    objectWrap: 'preserve',
    // Node's modules, other packages, the project's packages by the names
    // that they export, then by their private paths, then relative paths,
    // nearest last
    sortImports: {
        groups: [
            'builtin',
            'external',
            'internal',
            'subpath',
            'parent',
            ['sibling', 'index'],
            'unknown'
        ],
        newlinesBetween: false
    },
    overrides: [
        {
            files: ['**/*.test.ts', '**/*.test.tsx'],
            options: { printWidth: 100 }
        },
        {
            files: ['**/tsconfig.json', '**/tsconfig.*.json'],
            options: { printWidth: 60 }
        },
        {
            // GitHub's workflows and Dependabot's configuration, as GitHub's
            // documentation writes them
            files: ['**/*.yml', '**/*.yaml'],
            options: { tabWidth: 2, singleQuote: false }
        }
    ]
} satisfies OxfmtConfig;

export default config;
