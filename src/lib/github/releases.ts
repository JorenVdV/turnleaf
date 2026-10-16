import { Capacitor, CapacitorHttp } from '@capacitor/core';

// The part of a release that GitHub's and Gitea's latest-release endpoints both return.
type Release = {
  name: string | null;
  tag_name: string;
  published_at: string | null;
  assets: { name: string }[];
};

export type ReleaseBanner = {
  version: string;
  releaseUrl: string;
  downloadUrl: string | null;
  publishedAt: string | null;
  title: string | null;
};

// Each release carries one APK per build variant; android-release.yml uploads them under these names.
// GitHub lists release assets alphabetically and builds before the per-variant check offer the
// first .apk, so the legacy name must sort after the release name.
export const RELEASE_APK_ASSET = 'app-release.apk';
export const LEGACY_WEBVIEW_APK_ASSET = 'turnleaf-legacy-webview.apk';

export type ReleaseRepository = {
  pageUrl: string;
  latestReleaseApiUrl: string;
};

// The repository whose releases the update banner offers, set per build through
// TURNLEAF_RELEASE_REPOSITORY. A github.com repository uses GitHub's API; any other host is
// treated as a Gitea server.
export function parseReleaseRepository(raw: string): ReleaseRepository | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    return null;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2 || !segments.every((segment) => /^[A-Za-z0-9._-]+$/.test(segment))) {
    return null;
  }
  const pageUrl = `${url.origin}/${segments.join('/')}`;
  const repository = segments.slice(-2).join('/');

  if (url.hostname.toLowerCase() === 'github.com') {
    if (segments.length !== 2) return null;
    return {
      pageUrl,
      latestReleaseApiUrl: `https://api.github.com/repos/${repository}/releases/latest`,
    };
  }

  // Gitea may be served from a sub-path, which then prefixes its API too.
  const prefix = segments
    .slice(0, -2)
    .map((segment) => `/${segment}`)
    .join('');
  return {
    pageUrl,
    latestReleaseApiUrl: `${url.origin}${prefix}/api/v1/repos/${repository}/releases/latest`,
  };
}

const releaseRepository = parseReleaseRepository(__RELEASE_REPOSITORY__);

type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
  build: string[];
};

function parseVersion(raw: string): ParsedVersion | null {
  const match = raw
    .trim()
    .replace(/^v/i, '')
    .match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
    build: match[5] ? match[5].split('.') : [],
  };
}

function compareSegments(left: string[], right: string[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftNumber = Number(leftPart);
    const rightNumber = Number(rightPart);
    const leftIsNumber = Number.isInteger(leftNumber) && String(leftNumber) === leftPart;
    const rightIsNumber = Number.isInteger(rightNumber) && String(rightNumber) === rightPart;
    if (leftIsNumber && rightIsNumber) return leftNumber - rightNumber;
    if (leftIsNumber) return -1;
    if (rightIsNumber) return 1;
    return leftPart.localeCompare(rightPart);
  }

  return 0;
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;

  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;

  const aPre = a.prerelease;
  const bPre = b.prerelease;
  if (!aPre.length && !bPre.length) return compareSegments(a.build, b.build);
  if (!aPre.length) return 1;
  if (!bPre.length) return -1;

  const prerelease = compareSegments(aPre, bPre);
  if (prerelease !== 0) return prerelease;
  // Turnleaf APK releases use build metadata to distinguish successive release builds.
  return compareSegments(a.build, b.build);
}

function buildBanner(
  release: Release,
  currentVersion: string,
  apkAssetName: string,
  repository: ReleaseRepository,
): ReleaseBanner | null {
  if (!release || typeof release.tag_name !== 'string') return null;

  const tagName = release.tag_name.trim();
  const latestVersion = tagName.replace(/^v/i, '');
  if (!parseVersion(latestVersion)) return null;
  if (compareVersions(latestVersion, currentVersion) <= 0) return null;

  // Links are built from the configured repository instead of taken from the response: Gitea
  // reports them under its ROOT_URL, which can be a LAN address a device cannot open.
  const tagPath = encodeURIComponent(tagName);
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const hasApk = assets.some(
    (asset) => asset && typeof asset === 'object' && asset.name === apkAssetName,
  );

  return {
    version: latestVersion,
    releaseUrl: `${repository.pageUrl}/releases/tag/${tagPath}`,
    downloadUrl: hasApk
      ? `${repository.pageUrl}/releases/download/${tagPath}/${apkAssetName}`
      : null,
    publishedAt: release.published_at,
    title: release.name,
  };
}

async function requestJson(url: string, timeoutMs: number): Promise<unknown> {
  const headers = { Accept: 'application/json' };

  // Gitea sends no CORS headers, so native builds make the request outside the WebView.
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({
      url,
      headers,
      responseType: 'json',
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
    });
    if (response.status < 200 || response.status >= 300) return null;
    return typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers });
    if (!response.ok) return null;
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchLatestRelease(
  currentVersion: string,
  apkAssetName = RELEASE_APK_ASSET,
  repository = releaseRepository,
  timeoutMs = 4500,
): Promise<ReleaseBanner | null> {
  if (!repository) return null;
  try {
    const release = (await requestJson(repository.latestReleaseApiUrl, timeoutMs)) as Release;
    return buildBanner(release, currentVersion, apkAssetName, repository);
  } catch {
    return null;
  }
}
