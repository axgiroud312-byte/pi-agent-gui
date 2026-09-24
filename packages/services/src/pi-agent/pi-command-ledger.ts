import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { commandAckSchema, type CommandAck } from "@zcode/shared/zcode-protocol-v4";

/** Durable admission fence, not an alternative copy of Pi's conversation history. */
export class PiCommandLedger {
  constructor(private readonly directory: string) {}

  private path(key: string): string {
    return join(this.directory, `${createHash("sha256").update(key).digest("hex")}.json`);
  }

  async read(key: string): Promise<CommandAck | "pending" | undefined> {
    try {
      const value: unknown = JSON.parse(await readFile(this.path(key), "utf8"));
      if (typeof value !== "object" || value === null || !("ack" in value)) throw new Error("Invalid Pi command receipt");
      const ack = (value as { ack: unknown }).ack;
      return ack === null ? "pending" : commandAckSchema.parse(ack);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      // Corrupt receipts are NOT permission to replay a potentially executed command.
      throw error;
    }
  }

  async reserve(key: string): Promise<boolean> {
    await mkdir(this.directory, { recursive: true });
    try {
      await writeFile(this.path(key), JSON.stringify({ ack: null }), { flag: "wx" });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  }

  async settle(key: string, ack: CommandAck): Promise<void> {
    const path = this.path(key);
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify({ ack }), { flag: "wx" });
      await rename(temp, path);
    } finally { await unlink(temp).catch(() => {}); }
  }
}
