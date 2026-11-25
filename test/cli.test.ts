import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const repoRoot = path.resolve(__dirname, "..");
const cliEntry = path.join(repoRoot, "src", "cli.ts");
const tsxBin = path.join(repoRoot, "node_modules", ".bin", "tsx");

const fixtureSpec = {
  openapi: "3.0.3",
  info: {
    title: "Fixture API",
    version: "1.0.0",
  },
  tags: [{ name: "Pets", description: "Pet operations" }],
  paths: {
    "/pets": {
      get: {
        tags: ["Pets"],
        summary: "List pets",
        responses: {
          "200": {
            description: "ok",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Pet" },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: "object",
        required: ["id", "name"],
        properties: {
          id: { type: "integer", format: "int64" },
          name: { type: "string" },
        },
      },
    },
  },
};

function runCli(
  cwd: string,
  args: string[]
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(tsxBin, [cliEntry, ...args], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

describe("openapi-reference cli", () => {
  let workDir: string;

  before(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "openapi-reference-"));
  });

  after(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it("exits with code 1 for an unknown command", async () => {
    const result = await runCli(workDir, ["not-a-command"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Unknown command/);
  });

  it("fails when openapi-config.yaml is missing", async () => {
    const result = await runCli(workDir, ["split"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /openapi-config\.yaml not found/);
  });

  it("runs parse, split, types, and changes against a local fixture", async () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "openapi-reference-fixture-"));

    fs.writeFileSync(
      path.join(fixtureDir, "openapi-config.yaml"),
      [
        'openapiUrl: "http://localhost:9/unused"',
        'outputDir: "./openapi/domains"',
        'typesOutputDir: "./openapi/types"',
        'cacheDir: "./openapi/.cache"',
        "",
      ].join("\n"),
      "utf8"
    );

    const openapiDir = path.join(fixtureDir, "openapi");
    fs.mkdirSync(openapiDir, { recursive: true });
    fs.writeFileSync(
      path.join(openapiDir, "api-docs.json"),
      JSON.stringify(fixtureSpec, null, 2) + "\n",
      "utf8"
    );

    const parseResult = await runCli(fixtureDir, ["parse"]);
    assert.equal(parseResult.code, 0, parseResult.stderr);
    assert.match(parseResult.stdout, /Parsed OpenAPI document/);

    const splitResult = await runCli(fixtureDir, ["split"]);
    assert.equal(splitResult.code, 0, splitResult.stderr);
    const domainFile = path.join(fixtureDir, "openapi", "domains", "pets.json");
    assert.ok(fs.existsSync(domainFile), "expected pets.json domain file");

    const typesResult = await runCli(fixtureDir, ["types"]);
    assert.equal(typesResult.code, 0, typesResult.stderr);
    const typesFile = path.join(fixtureDir, "openapi", "types", "pets.ts");
    assert.ok(fs.existsSync(typesFile), "expected pets.ts types file");
    const typesContent = fs.readFileSync(typesFile, "utf8");
    assert.match(typesContent, /export interface Pet/);

    const changesResult = await runCli(fixtureDir, ["changes"]);
    assert.equal(changesResult.code, 0, changesResult.stderr);
    assert.match(changesResult.stdout, /New endpoints: 1/);

    const cacheDir = path.join(fixtureDir, "openapi", ".cache");
    const reportFiles = fs
      .readdirSync(cacheDir)
      .filter((name) => name.startsWith("changes-") && name.endsWith(".json"));
    assert.ok(reportFiles.length >= 1, "expected a change report");

    const secondChanges = await runCli(fixtureDir, ["changes"]);
    assert.equal(secondChanges.code, 0, secondChanges.stderr);
    assert.match(secondChanges.stdout, /No changes detected/);

    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });
});
