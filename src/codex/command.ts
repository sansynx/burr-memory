import { dispatchCodexHook } from "./adapter.js";

try {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > 4 * 1024 * 1024) throw new Error("Hook input too large");
    chunks.push(bytes);
  }
  const result = await dispatchCodexHook(
    JSON.parse(Buffer.concat(chunks).toString("utf8")),
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch {
  process.stderr.write(
    "Burr could not process this Codex hook. Check the local installation and storage permissions.\n",
  );
  process.exitCode = 1;
}
