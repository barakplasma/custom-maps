// Follows the OS light/dark setting live. Web Awesome needs an explicit
// wa-light / wa-dark class on <html>; index.html sets it before first paint.
export function schemeClass(prefersDark: boolean): 'wa-dark' | 'wa-light' {
  return prefersDark ? 'wa-dark' : 'wa-light';
}

export function applyColorScheme(root: HTMLElement, prefersDark: boolean): void {
  root.classList.remove('wa-dark', 'wa-light');
  root.classList.add(schemeClass(prefersDark));
}

export function followSystemColorScheme(root: HTMLElement = document.documentElement): void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  applyColorScheme(root, query.matches);
  query.addEventListener('change', (e) => applyColorScheme(root, e.matches));
}
