import tailwindcss from '@tailwindcss/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import {
  DEV_PROXY_PREFIX,
  decodeProxyTarget,
  parseAllowedOrigins,
  proxyRequestHeaders,
  readProxyBody,
  sendProxyResponse,
  DevProxyError,
  fetchProxyTarget,
  validateProxyTarget,
} from './scripts/dev-proxy';
import { LEGACY_WEBVIEW_TARGET, legacyWebviewCss } from './scripts/legacy-webview-css';

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};
const appVersion = process.env.TURNLEAF_VERSION_NAME ?? packageJson.version;
// Builds for WebViews that cannot be updated (e.g. Onyx's Android 9 firmware, WebView 86).
const legacyWebview = process.env.TURNLEAF_LEGACY_WEBVIEW === '1';
// The repository the update banner checks for releases: a github.com or Gitea repository page.
const releaseRepository =
  process.env.TURNLEAF_RELEASE_REPOSITORY || 'https://github.com/JorenVdV/turnleaf';

function kavitaDevProxy(): Plugin {
  const allowedOrigins = parseAllowedOrigins();

  return {
    name: 'turnleaf-kavita-dev-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(DEV_PROXY_PREFIX)) {
          next();
          return;
        }

        try {
          const encodedTarget = req.url.slice(DEV_PROXY_PREFIX.length);
          const target = decodeProxyTarget(encodedTarget);
          const targetResult = validateProxyTarget(target, allowedOrigins);
          if (!targetResult.ok) {
            throw new DevProxyError(400, 'The Kavita development proxy target is not allowed.');
          }

          const body = await readProxyBody(req);
          const response = await fetchProxyTarget(targetResult.url, {
            method: req.method ?? 'GET',
            headers: proxyRequestHeaders(req.headers),
            body: body as unknown as BodyInit | undefined,
          });
          await sendProxyResponse(res, response);
        } catch (error) {
          if (res.headersSent) {
            res.destroy();
            return;
          }

          const proxyError =
            error instanceof DevProxyError
              ? error
              : new DevProxyError(502, 'The Kavita development proxy request failed.');
          res.statusCode = proxyError.statusCode;
          res.setHeader('content-type', 'text/plain; charset=utf-8');
          res.end(proxyError.message);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), svelte(), kavitaDevProxy(), legacyWebview && legacyWebviewCss()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __LEGACY_WEBVIEW__: JSON.stringify(legacyWebview),
    __RELEASE_REPOSITORY__: JSON.stringify(releaseRepository),
  },
  build: {
    target: legacyWebview ? LEGACY_WEBVIEW_TARGET : 'es2022',
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
  },
});
