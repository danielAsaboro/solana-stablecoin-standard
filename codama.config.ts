import { createFromRoot } from "codama";
import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor } from "@codama/renderers-js";
import { readFileSync } from "fs";
import { join } from "path";

// Read Anchor IDL files
const sssIdl = JSON.parse(
  readFileSync(join(__dirname, "target/idl/sss.json"), "utf8")
);
const transferHookIdl = JSON.parse(
  readFileSync(join(__dirname, "target/idl/transfer_hook.json"), "utf8")
);

// Generate SSS client
const sssRoot = rootNodeFromAnchor(sssIdl);
const sssCodama = createFromRoot(sssRoot);
sssCodama.accept(renderVisitor(join(__dirname, "sdk/codama/sss")));

// Generate Transfer Hook client
const hookRoot = rootNodeFromAnchor(transferHookIdl);
const hookCodama = createFromRoot(hookRoot);
hookCodama.accept(renderVisitor(join(__dirname, "sdk/codama/transfer-hook")));

console.log("Codama clients generated successfully in sdk/codama/");
