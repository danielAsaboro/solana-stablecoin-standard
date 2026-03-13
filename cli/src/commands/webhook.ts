import { createHmac, timingSafeEqual } from "crypto";
import { readFileSync } from "fs";
import { Command } from "commander";

function normalizeSignature(signature: string): string {
  return signature.trim().replace(/^sha256=/i, "");
}

export function verifyWebhookSignature(
  secret: string,
  payload: string,
  signature: string
): { expected: string; valid: boolean } {
  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  const received = normalizeSignature(signature);
  const valid =
    expected.length === received.length &&
    timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));

  return {
    expected: `sha256=${expected}`,
    valid,
  };
}

export function registerWebhookCommand(program: Command): void {
  const webhook = program.command("webhook").description("Webhook operator tooling");

  webhook
    .command("verify")
    .description("Verify an X-SSS-Signature header against a captured payload body")
    .requiredOption("--secret <value>", "Shared webhook secret")
    .requiredOption("--signature <value>", "Signature header value, e.g. sha256=...")
    .option("--payload-file <path>", "Path to a file containing the exact raw request body")
    .option("--payload <json>", "Literal payload string to verify")
    .action((options: { secret: string; signature: string; payloadFile?: string; payload?: string }) => {
      const payload =
        options.payload ??
        (options.payloadFile ? readFileSync(options.payloadFile, "utf8") : undefined);

      if (!payload) {
        throw new Error("Provide either --payload or --payload-file");
      }

      const result = verifyWebhookSignature(options.secret, payload, options.signature);
      const output = {
        valid: result.valid,
        expected: result.expected,
        received: options.signature,
      };

      console.log(JSON.stringify(output, null, 2));
      if (!result.valid) {
        process.exitCode = 1;
      }
    });
}
