import { loadOpenApiSpec, resolveConfiguredServices } from "./fetch";
import { OpenAPISpec } from "./utils";

export interface ParsedSpec {
  spec: OpenAPISpec;
  tags: Map<string, { name: string; description?: string }>;
  pathsByTag: Map<string, string[]>;
}

/**
 * parse every configured service (or one service when filtered)
 */
export function parseAllServices(serviceFilter?: string): void {
  for (const { name } of resolveConfiguredServices(serviceFilter)) {
    parseOpenApiSpec(name);
  }
}

/**
 * parse and validate the fetched openapi document for one service
 */
export function parseOpenApiSpec(serviceName: string): ParsedSpec {
  const spec = loadOpenApiSpec(serviceName);

  if (!spec.openapi && !spec.swagger) {
    throw new Error("Invalid OpenAPI document: missing 'openapi' or 'swagger' field");
  }

  if (!spec.paths || typeof spec.paths !== "object") {
    throw new Error("Invalid OpenAPI document: missing or invalid 'paths'");
  }

  if (!spec.components) {
    console.warn("Warning: OpenAPI document has no 'components' section");
  }

  const tags = new Map<string, { name: string; description?: string }>();
  if (spec.tags && Array.isArray(spec.tags)) {
    for (const tag of spec.tags) {
      tags.set(tag.name, {
        name: tag.name,
        description: tag.description,
      });
    }
  }

  const pathsByTag = new Map<string, string[]>();

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    if (!pathItem || typeof pathItem !== "object") {
      continue;
    }

    const operations = Object.values(pathItem).filter(
      (op) => op && typeof op === "object" && "tags" in op
    );

    for (const operation of operations) {
      const op = operation as Record<string, unknown>;
      if (!op.tags || !Array.isArray(op.tags)) {
        continue;
      }

      for (const tagName of op.tags as string[]) {
        if (!pathsByTag.has(tagName)) {
          pathsByTag.set(tagName, []);
        }
        const paths = pathsByTag.get(tagName) as string[];
        if (!paths.includes(path)) {
          paths.push(path);
        }
      }
    }
  }

  for (const tagName of Array.from(pathsByTag.keys())) {
    if (!tags.has(tagName)) {
      tags.set(tagName, { name: tagName });
    }
  }

  console.log(`Parsed OpenAPI document (${serviceName}):`);
  console.log(`   Version: ${spec.openapi || spec.swagger}`);
  console.log(`   Title: ${spec.info?.title || "N/A"}`);
  console.log(`   Tags: ${tags.size}`);
  console.log(`   Paths: ${Object.keys(spec.paths).length}`);
  console.log(
    `   Schemas: ${spec.components?.schemas ? Object.keys(spec.components.schemas).length : 0}`
  );

  return {
    spec,
    tags,
    pathsByTag,
  };
}
