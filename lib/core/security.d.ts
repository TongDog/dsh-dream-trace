/** Redact recognizable secrets; this cannot detect arbitrary unlabeled credentials.
 * @param text Source text.
 * @returns Text safe against the supported credential patterns.
 */
export declare function redactSecrets(text: string): string;
/** @param text Candidate content. @returns Whether a known credential pattern occurs. */
export declare function containsSecret(text: string): boolean;
