import type { UpdateStatus } from './ui-protocol.ts';
/** The public source repository for this plugin. */
export declare const PROJECT_URL = "https://github.com/TongDog/dsh-dream-trace";
/**
 * Manifest feeds, tried in order. The Contents API is first because some networks
 * block raw.githubusercontent.com; the raw CDN is cheaper for everyone else, and the
 * npm registry only answers once the package is published there.
 */
export declare const UPDATE_FEEDS: readonly ["https://api.github.com/repos/TongDog/dsh-dream-trace/contents/package.json?ref=main", "https://raw.githubusercontent.com/TongDog/dsh-dream-trace/main/package.json", "https://registry.npmjs.org/dsh-plugin-dreaming/latest"];
/** Read the version from the package.json shipped next to lib/ (also correct under tsx from src/). */
export declare function installedVersion(): string;
/** Compare two semantic versions: negative when left is older, positive when newer. */
export declare function compareVersions(left: string, right: string): number;
export interface UpdateCheckOptions {
    version?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    feeds?: readonly string[];
    fetch?: typeof fetch;
}
/** Fetch the published manifest and compare it with the installed version. Never throws for network or feed failures. */
export declare function checkForUpdate(options?: UpdateCheckOptions): Promise<UpdateStatus>;
