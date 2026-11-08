/** Conservative removal of common credentials before any model call or persistence. */
const rules = [
    /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
    /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|AKIA[A-Z0-9]{16})\b/g,
    /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}=*/gi,
    /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret|client[_-]?secret)\b(["']?\s*[:=]\s*["']?)[^\s,"';}]{4,}/gi,
    /:\/\/[^\s/:@]+:[^\s/@]+@/g,
];
/** Redact recognizable secrets; this cannot detect arbitrary unlabeled credentials.
 * @param text Source text.
 * @returns Text safe against the supported credential patterns.
 */
export function redactSecrets(text) {
    let output = text;
    for (const rule of rules)
        output = output.replace(rule, '[REDACTED]');
    return output;
}
/** @param text Candidate content. @returns Whether a known credential pattern occurs. */
export function containsSecret(text) { return redactSecrets(text) !== text; }
//# sourceMappingURL=security.js.map