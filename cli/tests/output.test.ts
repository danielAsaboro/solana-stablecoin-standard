import { expect } from "chai";
import {
  getOutputFormat,
  isDryRun,
  printCsv,
} from "../src/output";

describe("CLI Output Helpers", () => {
  it("defaults to table output", () => {
    expect(getOutputFormat({})).to.equal("table");
  });

  it("recognizes json and csv output formats", () => {
    expect(getOutputFormat({ output: "json" })).to.equal("json");
    expect(getOutputFormat({ output: "csv" })).to.equal("csv");
  });

  it("treats unknown output formats as table", () => {
    expect(getOutputFormat({ output: "yaml" })).to.equal("table");
  });

  it("detects dry-run mode", () => {
    expect(isDryRun({ dryRun: true })).to.equal(true);
    expect(isDryRun({ dryRun: false })).to.equal(false);
  });

  it("renders CSV and escapes commas and quotes", () => {
    const writes: Array<string> = [];
    const original = console.log;
    console.log = (value?: unknown) => {
      writes.push(String(value ?? ""));
    };

    try {
      printCsv(
        [
          { name: "Alpha", note: "plain" },
          { name: "Beta, Inc.", note: "contains \"quotes\"" },
        ],
        [
          { header: "name", value: (row) => row.name },
          { header: "note", value: (row) => row.note },
        ]
      );
    } finally {
      console.log = original;
    }

    expect(writes).to.have.length(1);
    expect(writes[0]).to.include("name,note");
    expect(writes[0]).to.include("\"Beta, Inc.\"");
    expect(writes[0]).to.include("\"contains \"\"quotes\"\"\"");
  });
});
