import { describe, expect, it } from 'vitest';
import { transformLegacyWebviewCss } from './legacy-webview-css';

// Chrome 86 drops a whole rule over any of these, so none may survive into the legacy bundle.
describe('legacy WebView CSS', () => {
  it('flattens cascade layers while keeping their order', async () => {
    const css = await transformLegacyWebviewCss(
      '@layer base{a{color:red}}@layer utilities{.x{color:blue}}',
    );
    expect(css).not.toContain('@layer');
    expect(css).toMatch(/a[^{]*\{color:red\}/);
    expect(css).toMatch(/\.x[^{]*\{color:blue\}/);
  });

  it('removes :where() and :is() from Svelte-scoped selectors', async () => {
    const css = await transformLegacyWebviewCss(
      '.tap-zones.svelte-1 button:where(.svelte-1){border:0}',
    );
    expect(css).not.toMatch(/:(where|is)\(/);
    expect(css).toContain('.tap-zones.svelte-1 button.svelte-1');
  });

  it('expands inset and logical shorthands to physical properties', async () => {
    const css = await transformLegacyWebviewCss('.a{inset:0 1px}.b{margin-inline:2px}');
    expect(css).not.toMatch(/[{;]inset:|margin-inline:/);
    expect(css).toMatch(/top:0/);
    expect(css).toMatch(/left:1px/);
    expect(css).toMatch(/margin-left:2px/);
  });

  it('gives aspect-ratio boxes a padding fallback', async () => {
    const css = await transformLegacyWebviewCss('.cover{aspect-ratio:2/3}');
    expect(css).toContain('@supports not (aspect-ratio: 1 / 1)');
    expect(css).toMatch(/\.cover::before\s*\{[^}]*padding-top:\s*150\.0000%/);
  });

  it('puts a vh fallback before dynamic viewport units', async () => {
    const css = await transformLegacyWebviewCss('.full{height:100dvh}');
    expect(css.indexOf('100vh')).toBeGreaterThan(-1);
    expect(css.indexOf('100vh')).toBeLessThan(css.indexOf('100dvh'));
  });
});
