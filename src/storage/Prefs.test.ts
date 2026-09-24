// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { getEditorView, setEditorView } from './Prefs';

describe('editor view prefs', () => {
  beforeEach(() => localStorage.clear());

  it('returns null when nothing is saved', () => {
    expect(getEditorView()).toBeNull();
  });

  it('round-trips a view with full double precision', () => {
    const view = { lat: 32.0853123456789, lon: 34.7818123456789, zoom: 16.25 };
    setEditorView(view);
    expect(getEditorView()).toEqual(view);
  });

  it.each([
    ['garbage', 'not json'],
    ['missing fields', '{"lat":1}'],
    ['non-numbers', '{"lat":"1","lon":2,"zoom":3}'],
    ['impossible latitude', '{"lat":123,"lon":2,"zoom":3}'],
  ])('ignores %s', (_label, raw) => {
    localStorage.setItem('cm.editorView', raw);
    expect(getEditorView()).toBeNull();
  });

  it('survives storage that throws', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    expect(getEditorView(broken)).toBeNull();
    expect(() => setEditorView({ lat: 0, lon: 0, zoom: 1 }, broken)).not.toThrow();
  });
});
