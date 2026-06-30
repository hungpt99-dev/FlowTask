import { healthCheckCommand } from "./commands/healthcheck.js";

export async function healthCommand(options?: { json?: boolean; log?: boolean }): Promise<void> {
  await healthCheckCommand(options);
}
