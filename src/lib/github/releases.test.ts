import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compareVersions,
  fetchLatestGithubRelease,
  LEGACY_WEBVIEW_APK_ASSET,
  RELEASE_APK_ASSET,
} from './releases';

const trustedAsset = {
  name: 'app-release.apk',
  browser_download_url:
    'https://github.com/JorenVdV/turnleaf/releases/download/v0.3.3%2B4/app-release.apk',
};

const trustedRelease = {
  html_url: 'https://github.com/JorenVdV/turnleaf/releases/tag/v0.3.3%2B4',
  name: 'Turnleaf 0.3.3',
  tag_name: 'v0.3.3+4',
  published_at: '2026-09-08T00:00:00Z',
  draft: false,
  prerelease: false,
  assets: [trustedAsset],
};

function mockRelease(release: typeof trustedRelease) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => release,
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('compareVersions', () => {
  it('orders patch and minor versions', () => {
    expect(compareVersions('0.1.1', '0.1.0')).toBeGreaterThan(0);
    expect(compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0);
  });

  it('treats stable releases as newer than prereleases', () => {
    expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBeLessThan(0);
  });

  it('treats build metadata as increasing release builds for Turnleaf', () => {
    expect(compareVersions('0.1.3+124', '0.1.3+123')).toBeGreaterThan(0);
    expect(compareVersions('0.1.3+1', '0.1.3')).toBeGreaterThan(0);
  });

  it('treats equal versions as equal', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });
});

describe('fetchLatestGithubRelease', () => {
  it('keeps links for the expected GitHub release and APK asset', async () => {
    mockRelease(trustedRelease);

    await expect(fetchLatestGithubRelease('0.3.2')).resolves.toEqual({
      version: '0.3.3+4',
      releaseUrl: trustedRelease.html_url,
      downloadUrl: trustedAsset.browser_download_url,
      publishedAt: trustedRelease.published_at,
      title: trustedRelease.name,
    });
  });

  it.each([
    'javascript:alert(1)',
    'http://github.com/JorenVdV/turnleaf/releases/tag/v0.3.3%2B4',
    'https://evil.example/releases/tag/v0.3.3%2B4',
    'https://github.com/another/repository/releases/tag/v0.3.3%2B4',
  ])('omits a banner when the release URL is unsafe or foreign: %s', async (htmlUrl) => {
    mockRelease({ ...trustedRelease, html_url: htmlUrl });

    await expect(fetchLatestGithubRelease('0.3.2')).resolves.toBeNull();
  });

  it.each([
    'javascript:alert(1)',
    'http://github.com/JorenVdV/turnleaf/releases/download/v0.3.3%2B4/app-release.apk',
    'https://evil.example/releases/download/v0.3.3%2B4/app-release.apk',
    'https://github.com/JorenVdV/other/releases/download/v0.3.3%2B4/app-release.apk',
  ])('omits an unsafe or foreign APK URL: %s', async (browserDownloadUrl) => {
    mockRelease({
      ...trustedRelease,
      assets: [{ ...trustedAsset, browser_download_url: browserDownloadUrl }],
    });

    await expect(fetchLatestGithubRelease('0.3.2')).resolves.toMatchObject({
      releaseUrl: trustedRelease.html_url,
      downloadUrl: null,
    });
  });

  it('omits APK assets with path traversal or a mismatched asset path', async () => {
    mockRelease({
      ...trustedRelease,
      assets: [
        {
          name: '../app-release.apk',
          browser_download_url:
            'https://github.com/JorenVdV/turnleaf/releases/download/v0.3.3%2B4/../app-release.apk',
        },
      ],
    });

    await expect(fetchLatestGithubRelease('0.3.2')).resolves.toMatchObject({
      releaseUrl: trustedRelease.html_url,
      downloadUrl: null,
    });
  });

  describe('with one APK per build variant', () => {
    const legacyAsset = {
      name: LEGACY_WEBVIEW_APK_ASSET,
      browser_download_url: `https://github.com/JorenVdV/turnleaf/releases/download/v0.3.3%2B4/${LEGACY_WEBVIEW_APK_ASSET}`,
    };

    it.each([
      ['legacy first', [legacyAsset, trustedAsset]],
      ['normal first', [trustedAsset, legacyAsset]],
    ])('offers a normal install only the normal APK (%s)', async (_order, assets) => {
      mockRelease({ ...trustedRelease, assets });

      await expect(fetchLatestGithubRelease('0.3.2', RELEASE_APK_ASSET)).resolves.toMatchObject({
        downloadUrl: trustedAsset.browser_download_url,
      });
    });

    it('offers a legacy WebView install only the legacy APK', async () => {
      mockRelease({ ...trustedRelease, assets: [trustedAsset, legacyAsset] });

      await expect(
        fetchLatestGithubRelease('0.3.2', LEGACY_WEBVIEW_APK_ASSET),
      ).resolves.toMatchObject({ downloadUrl: legacyAsset.browser_download_url });
    });

    it('names the legacy APK so it sorts after the release APK', () => {
      expect([LEGACY_WEBVIEW_APK_ASSET, RELEASE_APK_ASSET].sort()[0]).toBe(RELEASE_APK_ASSET);
    });

    it('links a legacy install to the release page when only the normal APK was published', async () => {
      mockRelease(trustedRelease);

      await expect(
        fetchLatestGithubRelease('0.3.2', LEGACY_WEBVIEW_APK_ASSET),
      ).resolves.toMatchObject({ releaseUrl: trustedRelease.html_url, downloadUrl: null });
    });
  });
});
