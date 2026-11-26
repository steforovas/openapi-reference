import * as fs from "fs";
import {
  ensureDir,
  writeJsonFile,
  OpenAPISpec,
  ServiceConfig,
  servicePaths,
  resolveServiceNameFromSpec,
  assertServiceNameAvailable,
  writeServiceMeta,
  resolveServiceName,
  selectServices,
} from "./utils";

/**
 * fetch every configured openapi document (or one service when filtered)
 */
export async function fetchAllServices(serviceFilter?: string): Promise<void> {
  for (const service of selectServices(serviceFilter)) {
    await fetchService(service);
  }
}

/**
 * fetch one openapi document and save it under openapi/{serviceName}/
 */
export async function fetchService(service: ServiceConfig): Promise<OpenAPISpec> {
  console.log(`Fetching OpenAPI document from: ${service.url}`);

  try {
    const response = await fetch(service.url, {
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

    const serviceName = resolveServiceNameFromSpec(service, spec);
    assertServiceNameAvailable(serviceName, service.url);

    const paths = servicePaths(serviceName);
    ensureDir(paths.root);
    writeJsonFile(paths.spec, spec);
    writeServiceMeta(serviceName, service.url);

    console.log(`OpenAPI document saved to: ${paths.spec}`);
    console.log(`   Service: ${serviceName}`);
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
        `Cannot connect to OpenAPI URL: ${service.url}\n` +
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
 * load the previously fetched openapi document for a service
 */
export function loadOpenApiSpec(serviceName: string): OpenAPISpec {
  const filePath = servicePaths(serviceName).spec;

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

/**
 * resolve each configured service name (config or previous fetch meta)
 */
export function resolveConfiguredServices(serviceFilter?: string): Array<{
  service: ServiceConfig;
  name: string;
}> {
  return selectServices(serviceFilter).map((service) => ({
    service,
    name: resolveServiceName(service),
  }));
}
