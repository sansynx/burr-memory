import { homedir } from "node:os";

export function userHome(): string {
  return process.env.BURR_HOME || homedir();
}
