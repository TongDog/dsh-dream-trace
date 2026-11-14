/** Host-only update metadata: the installed version, a bounded manifest fetch, and a non-throwing result. */
import { readFileSync } from 'node:fs';
/** The public source repository for this plugin. */
export const PROJECT_URL = 'https://github.com/TongDog/dsh-dream-trace';
/**
 * Manifest feeds, tried in order. The Contents API is first because some networks
 * block raw.githubusercontent.com; the raw CDN is cheaper for everyone else, and the
 * npm registry only answers once the package is published there.
 */
export const UPDATE_FEEDS = [
    'https://api.github.com/repos/TongDog/dsh-dream-trace/contents/package.json?ref=main',
    'https://raw.githubusercontent.com/TongDog/dsh-dream-trace/main/package.json',
    'https://registry.npmjs.org/dsh-plugin-dreaming/latest',
];
const REQUEST_TIMEOUT_MS = 8000;
const VERSION = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
/** Read the version from the package.json shipped next to lib/ (also correct under tsx from src/). */
export function installedVersion() {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    if (typeof manifest.version !== 'string' || !manifest.version)
        throw new Error('The installed package.json does not declare a version.');
    return manifest.version;
}
/** Compare two semantic versions: negative when left is older, positive when newer. */
export function compareVersions(left, right) {
    const a = parseVersion(left);
    const b = parseVersion(right);
    const length = Math.max(a.parts.length, b.parts.length);
    for (let index = 0; index < length; index += 1) {
        const difference = (a.parts[index] ?? 0) - (b.parts[index] ?? 0);
        if (difference !== 0)
            return Math.sign(difference);
    }
    return comparePrerelease(a.prerelease, b.prerelease);
}
function parseVersion(value) {
    const withoutBuild = value.trim().replace(/^v/i, '').split('+')[0] ?? '';
    const [core = '0', ...prerelease] = withoutBuild.split('-');
    return { parts: core.split('.').map(part => (/^\d+$/.test(part) ? Number(part) : 0)), prerelease: prerelease.join('.') };
}
function comparePrerelease(left, right) {
    if (left === right)
        return 0;
    // A release outranks any prerelease of the same core version.
    if (!left)
        return 1;
    if (!right)
        return -1;
    const a = left.split('.');
    const b = right.split('.');
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
        const x = a[index];
        const y = b[index];
        if (x === undefined)
            return -1;
        if (y === undefined)
            return 1;
        const numericX = /^\d+$/.test(x);
        const numericY = /^\d+$/.test(y);
        if (numericX && numericY) {
            const difference = Number(x) - Number(y);
            if (difference !== 0)
                return Math.sign(difference);
        }
        else if (numericX)
            return -1;
        else if (numericY)
            return 1;
        else {
            // Semver compares alphanumeric identifiers by ASCII order, not locale collation.
            if (x !== y)
                return x < y ? -1 : 1;
        }
    }
    return 0;
}
/** Build the non-throwing result shared by every failure path. */
function failed(version, error) {
    return { currentVersion: version, latestVersion: null, updateAvailable: false, checkedAt: new Date().toISOString(), projectUrl: PROJECT_URL, error: error.slice(0, 2000) };
}
/** Fetch the published manifest and compare it with the installed version. Never throws for network or feed failures. */
export async function checkForUpdate(options = {}) {
    const version = options.version ?? installedVersion();
    const request = options.fetch ?? fetch;
    const timeout = AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    let latestVersion = null;
    let error = null;
    const feeds = options.feeds ?? UPDATE_FEEDS;
    if (feeds.length === 0)
        return failed(version, 'No update feed is configured.');
    for (const feed of feeds) {
        try {
            const response = await request(feed, {
                signal, redirect: 'error',
                // The Contents API serves the raw manifest only for this media type; the other feeds ignore it.
                headers: { accept: 'application/vnd.github.raw', 'x-github-api-version': '2022-11-28', 'user-agent': `dsh-plugin-dreaming/${version}` },
            });
            if (!response.ok) {
                const remaining = response.headers?.get?.('x-ratelimit-remaining');
                throw new Error(response.status === 403 && remaining === '0'
                    ? 'The GitHub API rate limit was reached; try again later.'
                    : `The update feed returned HTTP ${response.status}.`);
            }
            const payload = await response.json();
            if (typeof payload.version !== 'string' || payload.version.length > 64 || !VERSION.test(payload.version)) {
                throw new Error('The update feed did not contain a valid version.');
            }
            latestVersion = payload.version;
            error = null;
            break;
        }
        catch (cause) {
            const message = cause instanceof Error ? cause.message : 'The update check failed.';
            error = error === null ? `${feed}: ${message}` : `${error}; ${feed}: ${message}`;
        }
    }
    return {
        currentVersion: version,
        latestVersion,
        updateAvailable: latestVersion !== null && compareVersions(latestVersion, version) > 0,
        checkedAt: new Date().toISOString(),
        projectUrl: PROJECT_URL,
        // The Remote schema bounds the error so a verbose feed cannot invalidate the whole result.
        error: error === null ? null : error.slice(0, 2000),
    };
}
//# sourceMappingURL=update-check.js.map