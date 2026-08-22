import { describe, expect, it } from "vitest";
import { redact } from "../src/shared/redaction.js";

describe("redact", () => {
  it("replaces JWTs before any other use of the text", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(redact(`token ${jwt}`)).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(redact(`token ${jwt}`)).toContain("[REDACTED]");
  });

  it("replaces API keys and bearer tokens", () => {
    const text = redact(
      "sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345 and Bearer abcdefghijklmnopqr",
    );
    expect(text).not.toMatch(/sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345/);
    expect(text).not.toMatch(/Bearer abcdefghijklmnopqr/);
    expect(text).toContain("[REDACTED]");
  });

  it("replaces PEM private keys", () => {
    const pem = `-----BEGIN RSA PRIVATE KEY-----
MIIBOgIBAAJBAK+fakekey
-----END RSA PRIVATE KEY-----`;
    expect(redact(pem)).not.toContain("BEGIN RSA PRIVATE KEY");
    expect(redact(pem)).toContain("[REDACTED]");
  });

  it("replaces password and secret assignments", () => {
    const text = redact("password=hunter2 DATABASE_URL=postgres://u:p@h/db");
    expect(text).not.toContain("hunter2");
    expect(text).toContain("[REDACTED]");
  });

  it("replaces home paths on unix and windows", () => {
    const text = redact("failed at /Users/alex/.ssh/id_rsa and C:\\Users\\alex\\secrets.env");
    expect(text).not.toContain("/Users/alex");
    expect(text).not.toMatch(/C:\\Users\\alex/);
    expect(text).toMatch(/\[HOME\]/);
  });

  it("replaces emails", () => {
    expect(redact("ping ada@example.com")).toContain("[EMAIL]");
    expect(redact("ping ada@example.com")).not.toContain("ada@example.com");
  });

  it("replaces query-string secrets", () => {
    const text = redact("https://api.example.com/x?token=abc123secret&ok=1");
    expect(text).not.toContain("abc123secret");
    expect(text).toContain("token=[REDACTED]");
  });

  it("replaces internal IPs and leaves loopback", () => {
    const text = redact("host 10.0.0.8 vs 127.0.0.1");
    expect(text).toContain("[IP]");
    expect(text).not.toContain("10.0.0.8");
    expect(text).toContain("127.0.0.1");
  });

  it("clips a field group to 12k characters", () => {
    const text = redact("x".repeat(20_000));
    expect(text.length).toBe(12_000);
  });
});
