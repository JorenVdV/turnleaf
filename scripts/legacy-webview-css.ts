import postcss, { type AcceptedPlugin, type Declaration, type Rule } from 'postcss';
import postcssPresetEnv from 'postcss-preset-env';
import selectorParser from 'postcss-selector-parser';
import type { Plugin } from 'vite';

// Oldest WebView the legacy build targets: Onyx's Android 9 firmware ships an Onyx-signed
// WebView 86 that cannot be updated, so Google's builds never install over it.
export const LEGACY_WEBVIEW_TARGET = 'chrome86';

// Chrome 86 drops a whole rule over one unknown pseudo-class, and :where() (Chrome 88) is in
// every Svelte-scoped selector. Rewriting it to :is() lets preset-env expand it away; the
// specificity bump is harmless once cascade layers are flattened too.
const whereToIs: AcceptedPlugin = {
  postcssPlugin: 'turnleaf-where-to-is',
  Rule(rule: Rule) {
    if (!rule.selector.includes(':where(')) return;
    rule.selector = selectorParser((root) => {
      root.walkPseudos((pseudo) => {
        if (pseudo.value === ':where') pseudo.value = ':is';
      });
    }).processSync(rule.selector);
  },
};

// `inset` arrived in Chrome 87. preset-env only rewrites the logical inset-* forms.
const insetLonghands: AcceptedPlugin = {
  postcssPlugin: 'turnleaf-inset-longhands',
  Declaration: {
    inset(decl: Declaration) {
      const parts = postcss.list.space(decl.value);
      const [top, right = top, bottom = top, left = right] = parts;
      decl.cloneBefore({ prop: 'top', value: top });
      decl.cloneBefore({ prop: 'right', value: right });
      decl.cloneBefore({ prop: 'bottom', value: bottom });
      decl.cloneBefore({ prop: 'left', value: left });
      decl.remove();
    },
  },
};

// Dynamic viewport units arrived in Chrome 108; without a vh fallback the declaration is
// dropped and full-height layouts collapse.
const viewportUnitFallback: AcceptedPlugin = {
  postcssPlugin: 'turnleaf-viewport-unit-fallback',
  Declaration(decl: Declaration) {
    if (!/\d(?:dvh|svh|lvh)\b/.test(decl.value)) return;
    const prev = decl.prev();
    if (prev?.type === 'decl' && prev.prop === decl.prop) return;
    decl.cloneBefore({ value: decl.value.replace(/(\d)(?:dvh|svh|lvh)\b/g, '$1vh') });
  },
};

// aspect-ratio arrived in Chrome 88; without it the cover boxes collapse to zero height. A floated
// pseudo-element with percentage padding (relative to width) gives the box its minimum height.
const aspectRatioFallback: AcceptedPlugin = {
  postcssPlugin: 'turnleaf-aspect-ratio-fallback',
  Declaration: {
    'aspect-ratio'(decl: Declaration) {
      const rule = decl.parent;
      if (rule?.type !== 'rule') return;
      const match = /^(\d*\.?\d+)\s*(?:\/\s*(\d*\.?\d+))?$/.exec(decl.value.trim());
      if (!match) return;
      const ratio = Number(match[2] ?? 1) / Number(match[1]);
      const fallback = postcss.atRule({ name: 'supports', params: 'not (aspect-ratio: 1 / 1)' });
      fallback.append(
        postcss
          .rule({
            selectors: (rule as Rule).selectors.map((selector) => `${selector}::before`),
          })
          .append(
            { prop: 'content', value: '""' },
            { prop: 'float', value: 'left' },
            { prop: 'padding-top', value: `${(ratio * 100).toFixed(4)}%` },
          ),
        postcss
          .rule({
            selectors: (rule as Rule).selectors.map((selector) => `${selector}::after`),
          })
          .append(
            { prop: 'content', value: '""' },
            { prop: 'display', value: 'block' },
            { prop: 'clear', value: 'both' },
          ),
      );
      rule.after(fallback);
    },
  },
};

const processor = postcss([
  aspectRatioFallback,
  whereToIs,
  insetLonghands,
  viewportUnitFallback,
  postcssPresetEnv({
    browsers: 'chrome 86',
    stage: false,
    features: {
      'cascade-layers': true,
      'is-pseudo-class': { onComplexSelector: 'warning' },
      'logical-properties-and-values': { inlineDirection: 'left-to-right' },
      'media-query-ranges': true,
    },
  }),
]);

export async function transformLegacyWebviewCss(css: string, from?: string): Promise<string> {
  return (await processor.process(css, { from })).css;
}

// Runs on the final CSS assets, after Tailwind and Vite's minifier, so it sees exactly what ships.
export function legacyWebviewCss(): Plugin {
  return {
    name: 'turnleaf-legacy-webview-css',
    apply: 'build',
    enforce: 'post',
    async generateBundle(_options, bundle) {
      for (const asset of Object.values(bundle)) {
        if (asset.type !== 'asset' || !asset.fileName.endsWith('.css')) continue;
        asset.source = await transformLegacyWebviewCss(String(asset.source), asset.fileName);
      }
    },
  };
}
