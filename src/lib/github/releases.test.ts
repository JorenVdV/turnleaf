import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compareVersions,
  fetchLatestRelease,
  LEGACY_WEBVIEW_APK_ASSET,
  parseReleaseRepository,
  RELEASE_APK_ASSET,
  type ReleaseRepository,
} from './releases';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
  CapacitorHttp: { get: vi.fn() },
}));

const githubRepository = parseReleaseRepository(
  'https://github.com/JorenVdV/turnleaf',
) as ReleaseRepository;
const giteaRepository = parseReleaseRepository(
  'https://gitea.home.jorenvdv.eu/JorenVdV/turnleaf',
) as ReleaseRepository;

const release = {
  name: 'Turnleaf 0.3.3',
  tag_name: 'v0.3.3+4',
  published_at: '2026-09-08T00:00:00Z',
  assets: [{ name: RELEASE_APK_ASSET }],
};

function mockRelease(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
  vi.mocked(CapacitorHttp.get).mockReset();
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

describe('parseReleaseRepository', () => {
  it('uses the GitHub API for a github.com repository', () => {
    expect(githubRepository).toEqual({
      pageUrl: 'https://github.com/JorenVdV/turnleaf',
      latestReleaseApiUrl: 'https://api.github.com/repos/JorenVdV/turnleaf/releases/latest',
    });
  });

  it('uses the Gitea API for any other host', () => {
    expect(giteaRepository).toEqual({
      pageUrl: 'https://gitea.home.jorenvdv.eu/JorenVdV/turnleaf',
      latestReleaseApiUrl:
        'https://gitea.home.jorenvdv.eu/api/v1/repos/JorenVdV/turnleaf/releases/latest',
    });
  });

  it('keeps the sub-path of a Gitea server in its API URL', () => {
    expect(parseReleaseRepository('https://example.test/git/owner/repo/')).toEqual({
      pageUrl: 'https://example.test/git/owner/repo',
      latestReleaseApiUrl: 'https://example.test/git/api/v1/repos/owner/repo/releases/latest',
    });
  });

  it.each([
    '',
    'not a url',
    'javascript:alert(1)',
    'http://gitea.home.jorenvdv.eu/JorenVdV/turnleaf',
    'https://user:secret@gitea.home.jorenvdv.eu/JorenVdV/turnleaf',
    'https://gitea.home.jorenvdv.eu/JorenVdV/turnleaf?x=1',
    'https://gitea.home.jorenvdv.eu/turnleaf',
    'https://github.com/org/JorenVdV/turnleaf',
  ])('rejects %j', (raw) => {
    expect(parseReleaseRepository(raw)).toBeNull();
  });
});

describe('fetchLatestRelease', () => {
  it('links the GitHub release and APK for a newer release', async () => {
    const fetchMock = mockRelease(release);

    await expect(fetchLatestRelease('0.3.2', RELEASE_APK_ASSET, githubRepository)).resolves.toEqual(
      {
        version: '0.3.3+4',
        releaseUrl: 'https://github.com/JorenVdV/turnleaf/releases/tag/v0.3.3%2B4',
        downloadUrl:
          'https://github.com/JorenVdV/turnleaf/releases/download/v0.3.3%2B4/app-release.apk',
        publishedAt: release.published_at,
        title: release.name,
      },
    );
    expect(fetchMock).toHaveBeenCalledWith(githubRepository.latestReleaseApiUrl, expect.anything());
  });

  it('builds Gitea links from the configured repository, not from the response', async () => {
    mockRelease({
      ...release,
      html_url: 'http://192.168.1.215:3000/JorenVdV/turnleaf/releases/tag/v0.3.3+4',
      assets: [
        {
          name: RELEASE_APK_ASSET,
          browser_download_url: 'https://evil.example/app-release.apk',
        },
      ],
    });

    await expect(
      fetchLatestRelease('0.3.2', RELEASE_APK_ASSET, giteaRepository),
    ).resolves.toMatchObject({
      releaseUrl: 'https://gitea.home.jorenvdv.eu/JorenVdV/turnleaf/releases/tag/v0.3.3%2B4',
      downloadUrl:
        'https://gitea.home.jorenvdv.eu/JorenVdV/turnleaf/releases/download/v0.3.3%2B4/app-release.apk',
    });
  });

  it('requests natively on Android, where Gitea sends no CORS headers', async () => {
    const fetchMock = mockRelease(null);
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(CapacitorHttp.get).mockResolvedValue({
      status: 200,
      data: JSON.stringify(release),
      headers: {},
      url: giteaRepository.latestReleaseApiUrl,
    });

    await expect(
      fetchLatestRelease('0.3.2', RELEASE_APK_ASSET, giteaRepository),
    ).resolves.toMatchObject({ version: '0.3.3+4' });
    expect(CapacitorHttp.get).toHaveBeenCalledWith(
      expect.objectContaining({ url: giteaRepository.latestReleaseApiUrl }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('omits a banner when the native request fails', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(CapacitorHttp.get).mockResolvedValue({
      status: 404,
      data: { message: 'Not Found' },
      headers: {},
      url: giteaRepository.latestReleaseApiUrl,
    });

    await expect(
      fetchLatestRelease('0.3.2', RELEASE_APK_ASSET, giteaRepository),
    ).resolves.toBeNull();
  });

  it('omits a banner when the release is not newer', async () => {
    mockRelease(release);

    await expect(
      fetchLatestRelease('0.3.3+4', RELEASE_APK_ASSET, githubRepository),
    ).resolves.toBeNull();
  });

  it.each(['../v0.3.3', 'v0.3.3+4/../../x', 'latest', ''])(
    'omits a banner for a tag that is not a version: %j',
    async (tagName) => {
      mockRelease({ ...release, tag_name: tagName });

      await expect(
        fetchLatestRelease('0.3.2', RELEASE_APK_ASSET, githubRepository),
      ).resolves.toBeNull();
    },
  );

  it('omits a banner without a configured repository', async () => {
    const fetchMock = mockRelease(release);

    await expect(fetchLatestRelease('0.3.2', RELEASE_APK_ASSET, null)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('with one APK per build variant', () => {
    const bothAssets = [{ name: LEGACY_WEBVIEW_APK_ASSET }, { name: RELEASE_APK_ASSET }];

    it('offers a normal install only the normal APK', async () => {
      mockRelease({ ...release, assets: bothAssets });

      await expect(
        fetchLatestRelease('0.3.2', RELEASE_APK_ASSET, githubRepository),
      ).resolves.toMatchObject({
        downloadUrl:
          'https://github.com/JorenVdV/turnleaf/releases/download/v0.3.3%2B4/app-release.apk',
      });
    });

    it('offers a legacy WebView install only the legacy APK', async () => {
      mockRelease({ ...release, assets: bothAssets });

      await expect(
        fetchLatestRelease('0.3.2', LEGACY_WEBVIEW_APK_ASSET, githubRepository),
      ).resolves.toMatchObject({
        downloadUrl: `https://github.com/JorenVdV/turnleaf/releases/download/v0.3.3%2B4/${LEGACY_WEBVIEW_APK_ASSET}`,
      });
    });

    it('names the legacy APK so it sorts after the release APK', () => {
      expect([LEGACY_WEBVIEW_APK_ASSET, RELEASE_APK_ASSET].sort()[0]).toBe(RELEASE_APK_ASSET);
    });

    it('links a legacy install to the release page when only the normal APK was published', async () => {
      mockRelease(release);

      await expect(
        fetchLatestRelease('0.3.2', LEGACY_WEBVIEW_APK_ASSET, githubRepository),
      ).resolves.toMatchObject({
        releaseUrl: 'https://github.com/JorenVdV/turnleaf/releases/tag/v0.3.3%2B4',
        downloadUrl: null,
      });
    });
  });
});
