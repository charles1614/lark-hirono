/**
 * Parse Feishu wiki URLs into host + node token.
 *
 * Accepts:
 *   - Full URL: https://scnajei2ds6y.feishu.cn/wiki/RK4aw2SgriDqDNkB6NLcXhZhnFf?from=copylink
 *   - Bare token: RK4aw2SgriDqDNkB6NLcXhZhnFf
 */

export interface ParsedWikiUrl {
  host: string;
  nodeToken: string;
}

export function parseWikiUrl(urlOrToken: string): ParsedWikiUrl {
  const trimmed = urlOrToken.trim();

  // Full URL: extract host and node token from path
  const urlMatch = trimmed.match(
    /^https?:\/\/([^/]+)\/wiki\/([A-Za-z0-9_-]+)/,
  );
  if (urlMatch) {
    return { host: urlMatch[1], nodeToken: urlMatch[2] };
  }

  // Bare token (alphanumeric, no slashes or dots)
  if (/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    return { host: "", nodeToken: trimmed };
  }

  throw new Error(`Cannot parse wiki URL or token: ${trimmed}`);
}
