import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as http from "node:http";

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

const untitledSpec = {
  openapi: "3.0.3",
  info: {
    version: "1.0.0",
  },
  paths: {
    "/items": {
      get: {
        tags: ["Items"],
        responses: { "200": { description: "ok" } },
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

function writeConfig(dir: string, yaml: string): void {
  fs.writeFileSync(path.join(dir, "openapi-config.yaml"), yaml, "utf8");
}

function seedService(
  dir: string,
  serviceName: string,
  url: string,
  spec: unknown
): void {
  const serviceDir = path.join(dir, "openapi", serviceName);
  fs.mkdirSync(serviceDir, { recursive: true });
  fs.writeFileSync(
    path.join(serviceDir, "api-docs.json"),
    JSON.stringify(spec, null, 2) + "\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(serviceDir, "service.json"),
    JSON.stringify({ url, name: serviceName }, null, 2) + "\n",
    "utf8"
  );
}

function startJsonServer(payload: unknown): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to bind test server"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/v3/api-docs`,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) {
                closeReject(error);
                return;
              }
              closeResolve();
            });
          }),
      });
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

  it("runs parse, split, types, and changes for a named service", async () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "openapi-reference-named-"));
    const url = "http://localhost:9/named";

    writeConfig(
      fixtureDir,
      ["services:", `  - url: "${url}"`, "    name: pets-api", ""].join("\n")
    );
    seedService(fixtureDir, "pets-api", url, fixtureSpec);

    const parseResult = await runCli(fixtureDir, ["parse"]);
    assert.equal(parseResult.code, 0, parseResult.stderr);
    assert.match(parseResult.stdout, /Parsed OpenAPI document \(pets-api\)/);

    const splitResult = await runCli(fixtureDir, ["split"]);
    assert.equal(splitResult.code, 0, splitResult.stderr);
    const domainFile = path.join(fixtureDir, "openapi", "pets-api", "domains", "pets.json");
    assert.ok(fs.existsSync(domainFile), "expected pets.json domain file");

    const typesResult = await runCli(fixtureDir, ["types"]);
    assert.equal(typesResult.code, 0, typesResult.stderr);
    const typesFile = path.join(fixtureDir, "openapi", "pets-api", "types", "pets.ts");
    assert.ok(fs.existsSync(typesFile), "expected pets.ts types file");
    assert.match(fs.readFileSync(typesFile, "utf8"), /export interface Pet/);

    const changesResult = await runCli(fixtureDir, ["changes"]);
    assert.equal(changesResult.code, 0, changesResult.stderr);
    assert.match(changesResult.stdout, /New endpoints: 1/);

    const cacheDir = path.join(fixtureDir, "openapi", "pets-api", ".cache");
    const reportFiles = fs
      .readdirSync(cacheDir)
      .filter((name) => name.startsWith("changes-") && name.endsWith(".json"));
    assert.ok(reportFiles.length >= 1, "expected a change report");

    const secondChanges = await runCli(fixtureDir, ["changes"]);
    assert.equal(secondChanges.code, 0, secondChanges.stderr);
    assert.match(secondChanges.stdout, /No changes detected/);

    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  it("derives service name from info.title when name is omitted", async () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "openapi-reference-title-"));
    const server = await startJsonServer(fixtureSpec);

    try {
      writeConfig(fixtureDir, ["services:", `  - url: "${server.url}"`, ""].join("\n"));

      const fetchResult = await runCli(fixtureDir, ["fetch"]);
      assert.equal(fetchResult.code, 0, fetchResult.stderr);
      assert.match(fetchResult.stdout, /Service: fixture-api/);

      const serviceDir = path.join(fixtureDir, "openapi", "fixture-api");
      assert.ok(fs.existsSync(path.join(serviceDir, "api-docs.json")));
      assert.ok(fs.existsSync(path.join(serviceDir, "service.json")));

      const parseResult = await runCli(fixtureDir, ["parse"]);
      assert.equal(parseResult.code, 0, parseResult.stderr);
      assert.match(parseResult.stdout, /Parsed OpenAPI document \(fixture-api\)/);
    } finally {
      await server.close();
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it("requires name when the document has no info.title", async () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "openapi-reference-untitled-"));
    const server = await startJsonServer(untitledSpec);

    try {
      writeConfig(fixtureDir, ["services:", `  - url: "${server.url}"`, ""].join("\n"));

      const fetchResult = await runCli(fixtureDir, ["fetch"]);
      assert.equal(fetchResult.code, 1);
      assert.match(fetchResult.stderr, /name is required/);
    } finally {
      await server.close();
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it("runs all for one service only", async () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "openapi-reference-one-"));
    const petsServer = await startJsonServer(fixtureSpec);
    const otherSpec = {
      ...fixtureSpec,
      info: { title: "Other API", version: "1.0.0" },
    };
    const otherServer = await startJsonServer(otherSpec);

    try {
      writeConfig(
        fixtureDir,
        [
          "services:",
          `  - url: "${petsServer.url}"`,
          "    name: pets-api",
          `  - url: "${otherServer.url}"`,
          "    name: other-api",
          "",
        ].join("\n")
      );

      const result = await runCli(fixtureDir, ["all", "pets-api"]);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /Service: pets-api/);
      assert.doesNotMatch(result.stdout, /Service: other-api/);

      assert.ok(fs.existsSync(path.join(fixtureDir, "openapi", "pets-api", "api-docs.json")));
      assert.ok(
        !fs.existsSync(path.join(fixtureDir, "openapi", "other-api", "api-docs.json")),
        "other-api should not be fetched"
      );
    } finally {
      await petsServer.close();
      await otherServer.close();
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it("fails when the service filter does not match", async () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "openapi-reference-missing-"));
    writeConfig(
      fixtureDir,
      ["services:", '  - url: "http://localhost:9/unused"', "    name: pets-api", ""].join("\n")
    );

    const result = await runCli(fixtureDir, ["all", "missing-api"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /No service named 'missing-api'/);

    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });
});
