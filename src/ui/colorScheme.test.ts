// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyColorScheme, schemeClass } from './colorScheme';

describe('color scheme', () => {
  it('maps the system preference to a Web Awesome class', () => {
    expect(schemeClass(true)).toBe('wa-dark');
    expect(schemeClass(false)).toBe('wa-light');
  });

  it('swaps classes without leaving both applied', () => {
    const root = document.createElement('html');
    applyColorScheme(root, true);
    applyColorScheme(root, false);
    expect([...root.classList]).toEqual(['wa-light']);
  });
});
