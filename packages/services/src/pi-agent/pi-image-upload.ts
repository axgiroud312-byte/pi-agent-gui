import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROTOCOL_V4_LIMITS,
  v4AttachmentBeginParamsSchema,
  v4AttachmentChunkParamsSchema,
  v4AttachmentCommitParamsSchema,
  type V4AttachmentBeginResult,
  type V4AttachmentChunkResult,
  type V4AttachmentCommitResult,
} from "@zcode/shared/zcode-protocol-v4";

interface Upload {
  workspaceKey: string;
  sessionId: string;
  uploadId: string;
  mime: string;
  totalBytes: number;
  totalChunks: number;
  checksum: string;
  bytes: number;
  chunks: Buffer[];
  ref?: string;
  commitFlight?: Promise<V4AttachmentCommitResult>;
}

/** Input staging only. Pi still owns the queue and message history; no image is dispatched here. */
export class PiImageUploads {
  private readonly uploads = new Map<string, Upload>();
  private directory?: Promise<string>;
  private closed = false;

  begin(workspaceKey: string, input: {
    uploadId: string; sessionId: string; fileName: string; mime: string;
    totalBytes: number; totalChunks: number; checksum: string;
  }): V4AttachmentBeginResult {
    if (this.closed) throw new Error("Pi image staging is closed");
    const parsed = v4AttachmentBeginParamsSchema.parse({ connectionId: workspaceKey,
      uploadId: input.uploadId, sessionId: input.sessionId, fileName: input.fileName,
      mime: input.mime, totalBytes: input.totalBytes, totalChunks: input.totalChunks,
      checksum: input.checksum });
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(parsed.mime)) {
      throw new Error("Pi prompt upload supports PNG, JPEG, GIF and WebP images only");
    }
    const existing = this.uploads.get(input.uploadId);
    if (existing) {
      this.owned(workspaceKey, input.sessionId, input.uploadId);
      if (existing.totalBytes !== input.totalBytes || existing.totalChunks !== input.totalChunks ||
        existing.checksum !== input.checksum || existing.mime !== input.mime) {
        throw new Error("Pi image upload metadata changed");
      }
      return existing.ref
        ? { uploadId: input.uploadId, state: "committed", nextChunkIndex: existing.totalChunks, ref: existing.ref }
        : { uploadId: input.uploadId, state: "staging", nextChunkIndex: existing.chunks.length };
    }
    if ([...this.uploads.values()].filter(upload => !upload.ref).length >= 8) {
      throw new Error("Too many concurrent Pi image uploads");
    }
    this.uploads.set(input.uploadId, { workspaceKey, sessionId: input.sessionId,
      uploadId: input.uploadId, mime: input.mime, totalBytes: input.totalBytes,
      totalChunks: input.totalChunks, checksum: input.checksum, bytes: 0, chunks: [] });
    return { uploadId: input.uploadId, state: "staging", nextChunkIndex: 0 };
  }

  chunk(workspaceKey: string, input: { uploadId: string; sessionId: string; chunkIndex: number; dataBase64: string }): V4AttachmentChunkResult {
    const parsed = v4AttachmentChunkParamsSchema.parse({ connectionId: workspaceKey,
      uploadId: input.uploadId, sessionId: input.sessionId, chunkIndex: input.chunkIndex,
      dataBase64: input.dataBase64 });
    const upload = this.owned(workspaceKey, parsed.sessionId, parsed.uploadId);
    if (upload.ref || parsed.chunkIndex !== upload.chunks.length || parsed.chunkIndex >= upload.totalChunks) {
      throw new Error("Pi image upload chunk is out of order");
    }
    const bytes = Buffer.from(parsed.dataBase64, "base64");
    if (upload.bytes + bytes.length > upload.totalBytes || bytes.length > PROTOCOL_V4_LIMITS.attachmentChunkMaxBytes) {
      throw new Error("Pi image upload exceeds declared size");
    }
    upload.chunks.push(bytes);
    upload.bytes += bytes.length;
    return { uploadId: input.uploadId, nextChunkIndex: upload.chunks.length };
  }

  async commit(workspaceKey: string, input: { uploadId: string; sessionId: string }): Promise<V4AttachmentCommitResult> {
    v4AttachmentCommitParamsSchema.parse({ connectionId: workspaceKey, uploadId: input.uploadId, sessionId: input.sessionId });
    const upload = this.owned(workspaceKey, input.sessionId, input.uploadId);
    if (upload.ref) return { ref: upload.ref };
    if (upload.commitFlight) return upload.commitFlight;
    if (upload.chunks.length !== upload.totalChunks || upload.bytes !== upload.totalBytes) {
      throw new Error("Pi image upload is incomplete");
    }
    const bytes = Buffer.concat(upload.chunks, upload.bytes);
    if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== upload.checksum) {
      throw new Error("Pi image upload checksum mismatch");
    }
    const pending = (async () => {
      const directory = await (this.directory ??= mkdtemp(join(tmpdir(), "pi-native-images-")));
      if (this.closed || this.uploads.get(upload.uploadId) !== upload) {
        throw new Error("Pi image upload was released");
      }
      const extension: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg",
        "image/gif": "gif", "image/webp": "webp" };
      const ref = join(directory, `${randomUUID()}.${extension[upload.mime]}`);
      await writeFile(ref, bytes, { flag: "wx", mode: 0o600 });
      if (this.closed || this.uploads.get(upload.uploadId) !== upload) {
        await rm(ref, { force: true });
        throw new Error("Pi image upload was released");
      }
      upload.ref = ref;
      upload.chunks = [];
      return { ref };
    })();
    upload.commitFlight = pending;
    try { return await pending; }
    finally { upload.commitFlight = undefined; }
  }

  abort(workspaceKey: string, input: { uploadId: string; sessionId: string }): void {
    v4AttachmentCommitParamsSchema.parse({ connectionId: workspaceKey, uploadId: input.uploadId, sessionId: input.sessionId });
    const upload = this.owned(workspaceKey, input.sessionId, input.uploadId);
    // Committed refs can already be in a Pi prompt or queue; never delete them on a late abort.
    if (!upload.ref) this.uploads.delete(input.uploadId);
  }

  /** Closing one workspace cannot leave its staged images readable by a later owner. */
  async releaseWorkspace(workspaceKey: string): Promise<void> {
    const owned = [...this.uploads.values()].filter(upload => upload.workspaceKey === workspaceKey);
    for (const upload of owned) this.uploads.delete(upload.uploadId);
    await Promise.all(owned.map(async upload => {
      // An in-flight commit observes the deleted identity and removes its file.
      // A commit already completed before release is removed here instead.
      await upload.commitFlight?.catch(() => {});
      if (upload.ref) await rm(upload.ref, { force: true });
    }));
  }

  async dispose(): Promise<void> {
    this.closed = true;
    const pending = [...this.uploads.values()].flatMap(upload => upload.commitFlight ? [upload.commitFlight] : []);
    this.uploads.clear();
    await Promise.allSettled(pending);
    if (this.directory) await rm(await this.directory, { recursive: true, force: true });
  }

  private owned(workspaceKey: string, sessionId: string, uploadId: string): Upload {
    if (this.closed) throw new Error("Pi image staging is closed");
    const upload = this.uploads.get(uploadId);
    if (!upload || upload.workspaceKey !== workspaceKey || upload.sessionId !== sessionId) {
      throw new Error("Pi image upload is not owned by this workspace and session");
    }
    return upload;
  }
}
