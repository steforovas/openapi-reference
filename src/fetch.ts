import * as fs from "fs";
import {
  loadOpenApiConfig,
  ensureDir,
  writeJsonFile,
  OpenAPISpec,
  specFilePath,
} from "./utils";
import * as path from "path";

/**
 * fetch the openapi document and save it locally
 */
export async function fetchOpenApiSpec(): Promise<OpenAPISpec> {
  const config = loadOpenApiConfig();
  const outputPath = specFilePath();

  console.log(`Fetching OpenAPI document from: ${config.openapiUrl}`);

  try {
    const response = await fetch(config.openapiUrl, {
      headers: {
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} error fetching OpenAPI document:\n` +
          `${response.statusText}`
      );
    }

    const spec = (await response.json()) as OpenAPISpec;

    if (!spec) {
      throw new Error("Empty response from OpenAPI URL");
    }

    if (!spec.openapi && !spec.swagger) {
      throw new Error("Response does not appear to be a valid OpenAPI document");
    }

    if (!spec.paths) {
      throw new Error("OpenAPI document is missing 'paths'");
    }

    ensureDir(path.dirname(outputPath));
    writeJsonFile(outputPath, spec);

    console.log(`OpenAPI document saved to: ${outputPath}`);
    console.log(`   Version: ${spec.openapi || spec.swagger}`);
    console.log(`   Title: ${spec.info?.title || "N/A"}`);
    console.log(`   Paths: ${Object.keys(spec.paths).length}`);

    return spec;
  } catch (error: any) {
    if (error instanceof Error && error.message.startsWith("HTTP ")) {
      throw error;
    }

    const cause = error?.cause;
    const code = cause?.code || error?.code;
    if (code === "ECONNREFUSED" || code === "ENOTFOUND") {
      throw new Error(
        `Cannot connect to OpenAPI URL: ${config.openapiUrl}\n` +
          `Error: ${error.message}`
      );
    }

    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error(`Network error fetching OpenAPI document: ${error.message}`);
    }

    if (error instanceof TypeError || cause) {
      throw new Error(`Network error fetching OpenAPI document: ${error.message}`);
    }

    throw error;
  }
}

/**
 * load the previously fetched openapi document
 */
export function loadOpenApiSpec(): OpenAPISpec {
  const filePath = specFilePath();

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `OpenAPI document not found at ${filePath}.\n` +
        `Run 'openapi-reference fetch' first.`
    );
  }

  const content = fs.readFileSync(filePath, "utf8");
  const spec = JSON.parse(content) as OpenAPISpec;

  if (!spec.paths) {
    throw new Error("Invalid OpenAPI document: missing 'paths'");
  }

  return spec;
}
