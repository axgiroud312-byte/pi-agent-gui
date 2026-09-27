import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** The pinned Pi 0.87.0 TUI /share fallback uses gh gist create --public=false. */
export async function publishPiSecretGist(htmlFile: string): Promise<string> {
  let output: string;
  try {
    const result = await execFileAsync("gh", ["gist", "create", "--public=false", htmlFile], {
      encoding: "utf8", timeout: 120_000, maxBuffer: 1024 * 1024, windowsHide: true,
    });
    output = result.stdout.trim();
  } catch (cause) {
    const error = cause as Error & { code?: string; stderr?: string };
    if (error.code === "ENOENT") throw new Error("GitHub CLI (gh) is not installed");
    throw new Error(`Gist creation failed; check gh auth status and your Gist list before retrying: ${
      error.stderr?.trim() || error.message}`);
  }
  return parsePiGistUrl(output).gistUrl;
}

export function parsePiGistUrl(output: string): { gistUrl: string; viewerUrl: string } {
  let url: URL;
  try { url = new URL(output); }
  catch { throw new Error("Gist creation returned an invalid URL; check your Gist list before retrying"); }
  const segments = url.pathname.split("/").filter(Boolean);
  const id = segments.at(-1);
  if (url.protocol !== "https:" || url.hostname !== "gist.github.com" ||
    segments.length < 1 || segments.length > 2 || !id || !/^[a-f0-9]{20,64}$/iu.test(id) ||
    url.username || url.password || url.search || url.hash) {
    throw new Error("Gist creation returned an unexpected URL; check your Gist list before retrying");
  }
  return { gistUrl: url.toString(), viewerUrl: `https://pi.dev/session/#${id}` };
}

/** Pi 0.87.0's HTML carries complete session data as Base64 JSON, including system prompt and tool schemas. */
export function decodePiHtmlSessionData(html: string): string {
  const encoded = /<script id="session-data" type="application\/json">([A-Za-z0-9+/=]+)<\/script>/u.exec(html)?.[1];
  if (!encoded) throw new Error("Pi HTML export has no reviewable embedded session data");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded) throw new Error("Pi HTML export has invalid embedded Base64 data");
  const json = bytes.toString("utf8");
  if (!Buffer.from(json).equals(bytes)) throw new Error("Pi HTML export has invalid embedded UTF-8 data");
  let data: unknown;
  try { data = JSON.parse(json); }
  catch { throw new Error("Pi HTML export has invalid embedded session JSON"); }
  if (!data || typeof data !== "object" || Array.isArray(data) ||
    !Array.isArray((data as Record<string, unknown>).entries)) {
    throw new Error("Pi HTML export has no session entries to review");
  }
  return JSON.stringify(data, null, 2);
}
