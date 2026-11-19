// Rules for Preact components and hooks, which a configuration extends after
// the base. The react plugin runs the rest of its rules of the base's
// categories too, except those turned off below.
import type { OxlintConfig } from 'oxlint';

const config = {
    plugins: ['react'],
    rules: {
        // Hooks are called at the top level of components and other hooks,
        // and effects, callbacks and memos list what they read. oxlint can't
        // tell that `useSignal` and `useComputed` return the same signal on
        // each render, so they list the signals that they read, which never
        // change, rather than the signals' values.
        'react/rules-of-hooks': 'error',
        'react/exhaustive-deps': 'error',
        'react/jsx-key': 'error',
        'react/self-closing-comp': 'error',

        // Turned off

        // The compiler imports Preact's JSX runtime, from `jsxImportSource`
        'react/react-in-jsx-scope': 'off',
        // A signal is written through `.value`, which this rule takes for a
        // change to the value that a hook returned
        'react/immutability': 'off'
    }
} satisfies OxlintConfig;

export default config;
