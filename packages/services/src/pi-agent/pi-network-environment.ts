import { readZCodeToolEnvPassthroughEnv } from "@zcode/shared";

const NETWORK_KEYS = new Set([
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "GIT_SSL_CAINFO",
]);

/** Restore the terminal network settings only at the Pi boundary, after ZCode host sanitization. */
export function restorePiNetworkEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...source };
  const explicit = new Set(Object.entries(source).filter(([, value]) => value !== undefined)
    .map(([key]) => key.toUpperCase()));
  for (const [key, value] of Object.entries(readZCodeToolEnvPassthroughEnv(source))) {
    if (NETWORK_KEYS.has(key.toUpperCase()) && !explicit.has(key.toUpperCase())) env[key] = value;
  }
  return env;
}
