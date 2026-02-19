import astro from 'eslint-plugin-astro';
import svelte from 'eslint-plugin-svelte';
import security from 'eslint-plugin-security';

export default [
  { ignores: ['dist/', 'node_modules/', '.astro/', 'tmp/'] },
  security.configs.recommended,
  ...astro.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    rules: {
      // Relax rules that clash with our patterns
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'security/detect-object-injection': 'off', // too noisy for array indexing
      'security/detect-non-literal-fs-filename': 'off', // we build paths from config
    },
  },
];
