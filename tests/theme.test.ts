import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { currentTheme, resolveTheme, setTheme, subscribeTheme, THEME_STORAGE_KEY } from '../src/studio/theme.ts';

test('the interface defaults to dark and only accepts an explicit light preference', () => {
  for (const value of [undefined, null, '', 'dark', 'system', 'invalid']) assert.equal(resolveTheme(value), 'dark');
  assert.equal(resolveTheme('light'), 'light');
});

test('the pre-paint script restores the preference and tolerates blocked storage', async () => {
  const script = await readFile(new URL('../public/assets/srtb-theme-init.js', import.meta.url), 'utf8');
  for (const preference of [null, 'dark', 'light', 'invalid', 'BLOCKED']) {
    const document = { documentElement: { dataset: { theme: 'dark' } } };
    const window = { localStorage: { getItem(key: string) {
      assert.equal(key, THEME_STORAGE_KEY);
      if (preference === 'BLOCKED') throw new Error('Storage disabled');
      return preference;
    } } };
    runInNewContext(script, { window, document });
    assert.equal(document.documentElement.dataset.theme, resolveTheme(preference));
  }
  const html = await readFile(new URL('../studio.html', import.meta.url), 'utf8');
  assert.match(html, /<html[^>]+data-theme="dark"/);
  assert.ok(html.indexOf('/assets/srtb-theme-init.js') < html.indexOf('<body>'));
});

test('theme toggles, persists, synchronizes other tabs, and unsubscribes without changing template data', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const values = new Map<string, string>();
  const target = new EventTarget();
  const document = { documentElement: { dataset: { theme: 'dark' } } };
  let blocked = false;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: Object.assign(target, { localStorage: {
    setItem(key: string, value: string) { if (blocked) throw Error('Blocked'); values.set(key, value); },
  } }) });
  try {
    let calls = 0;
    const unsubscribe = subscribeTheme(() => calls++);
    setTheme('light');
    assert.equal(currentTheme(), 'light');
    assert.equal(values.get(THEME_STORAGE_KEY), 'light');
    assert.equal(calls, 1);
    const storage = (key: string | null, newValue: string | null) => target.dispatchEvent(Object.assign(new Event('storage'), { key, newValue }));
    storage('unrelated', 'dark');
    assert.equal(currentTheme(), 'light');
    storage(THEME_STORAGE_KEY, 'dark');
    assert.equal(currentTheme(), 'dark');
    blocked = true;
    setTheme('light');
    assert.equal(currentTheme(), 'light');
    storage(null, null);
    assert.equal(currentTheme(), 'dark');
    assert.equal(calls, 4);
    unsubscribe();
    setTheme('light');
    assert.equal(calls, 4);
    assert.deepEqual([...values.keys()], [THEME_STORAGE_KEY]);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else Reflect.deleteProperty(globalThis, 'document');
  }
});

test('the password recovery action keeps its full label in dark and narrow layouts', async () => {
  const [studio,theme,responsive]=await Promise.all([
    readFile(new URL('../src/studio/studio.css',import.meta.url),'utf8'),
    readFile(new URL('../src/studio/theme.css',import.meta.url),'utf8'),
    readFile(new URL('../src/studio/responsive.css',import.meta.url),'utf8'),
  ]);
  assert.match(studio,/form~\.row>\.quiet\{[^}]*min-width:max-content[^}]*white-space:nowrap/);
  assert.match(theme,/auth-content>form~\.row>button\.quiet:disabled\s*\{[^}]*background:transparent[^}]*border-color:transparent/);
  assert.match(responsive,/form~\.row>\.quiet\{[^}]*max-width:100%[^}]*white-space:normal/);
});
