/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Web Awesome needs modern browsers (CSS nesting, :is()); target the same baseline.
const browsers = ['chrome111', 'edge111', 'firefox114', 'safari16.4'];

export default defineConfig({
  base: './',
  build: {
    target: browsers,
    cssTarget: browsers,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
