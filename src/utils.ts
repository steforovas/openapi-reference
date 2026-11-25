import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import crypto from "crypto";

export interface OpenApiConfig {
  openapiUrl: string;
  outputDir?: string;
  typesOutputDir?: string;
  cacheDir?: string;
  domains?: Record<string, { tag: string; description?: string }>;
}

export interface OpenAPISpec {
  openapi: string;
  // swagger 2 documents use this field instead of openapi
  swagger?: string;
  info: {
    title: string;
    description?: string;
  };
  tags?: Array<{ name: string; description?: string }>;
  paths: Record<string, any>;
  components?: {
    schemas?: Record<string, any>;
  };
}

export interface DomainData {
  tag: string;
  description?: string;
  paths: Record<string, any>;
  schemas: Record<string, any>;
}

/**
 * load openapi-config.yaml from the current working directory
 */
export function loadOpenApiConfig(): OpenApiConfig {
  const configPath = path.join(process.cwd(), "openapi-config.yaml");

  if (!fs.existsSync(configPath)) {
    throw new Error(
      "openapi-config.yaml not found in project root. Please create it with required openapiUrl."
    );
  }

  const configContent = fs.readFileSync(configPath, "utf8");
  const config = yaml.load(configContent) as OpenApiConfig;

  if (!config.openapiUrl) {
    throw new Error("openapiUrl is required in openapi-config.yaml");
  }

  config.outputDir = config.outputDir || "./openapi/domains";
  config.typesOutputDir = config.typesOutputDir || "./openapi/types";
  config.cacheDir = config.cacheDir || "./openapi/.cache";

  return config;
}

/**
 * resolve an OpenAPI $ref
 */
export function resolveRef(spec: OpenAPISpec, ref: string): any {
  if (!ref.startsWith("#/")) {
    throw new Error(`External references not supported: ${ref}`);
  }

  const parts = ref.slice(2).split("/");
  let current: any = spec;

  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = current[part];
    } else {
      throw new Error(`Reference not found: ${ref}`);
    }
  }

  return current;
}

/**
 * resolve $ref values in a schema
 */
export function resolveSchema(
  spec: OpenAPISpec,
  schema: any,
  visited: Set<string> = new Set()
): any {
  if (!schema || typeof schema !== "object") {
    return schema;
  }

  if (schema.$ref) {
    if (visited.has(schema.$ref)) {
      return { $ref: schema.$ref };
    }
    visited.add(schema.$ref);
    const resolved = resolveRef(spec, schema.$ref);
    return resolveSchema(spec, resolved, visited);
  }

  if (Array.isArray(schema)) {
    return schema.map((item) => resolveSchema(spec, item, visited));
  }

  const resolved: any = {};
  for (const [key, value] of Object.entries(schema)) {
    resolved[key] = resolveSchema(spec, value, visited);
  }

  return resolved;
}

/**
 * convert an OpenAPI schema to a TypeScript type string
 */
export function openApiTypeToTypeScript(schema: any, spec?: OpenAPISpec): string {
  if (schema.$ref && spec) {
    resolveRef(spec, schema.$ref);
    const schemaName = schema.$ref.split("/").pop() || "";
    return schemaName;
  }

  if (schema.type === "array") {
    const itemsType = schema.items
      ? openApiTypeToTypeScript(schema.items, spec)
      : "any";
    return `${itemsType}[]`;
  }

  if (schema.type === "object") {
    if (schema.additionalProperties) {
      const valueType = openApiTypeToTypeScript(schema.additionalProperties, spec);
      return `Record<string, ${valueType}>`;
    }
    return "Record<string, unknown>";
  }

  if (schema.enum) {
    return schema.enum.map((e: any) => `"${e}"`).join(" | ");
  }

  if (schema.oneOf || schema.anyOf) {
    const types = (schema.oneOf || schema.anyOf).map((s: any) =>
      openApiTypeToTypeScript(s, spec)
    );
    return types.join(" | ");
  }

  if (schema.allOf) {
    const types = schema.allOf.map((s: any) => openApiTypeToTypeScript(s, spec));
    return types.join(" & ");
  }

  switch (schema.type) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    default:
      return "unknown";
  }
}

/**
 * convert an OpenAPI schema to a Zod schema string
 */
export function openApiTypeToZod(schema: any, spec?: OpenAPISpec): string {
  if (schema.$ref && spec) {
    const schemaName = schema.$ref.split("/").pop() || "";
    return (
      schemaName.replace(/DTO$/, "").replace(/Request$/, "").replace(/Response$/, "") +
      "Schema"
    );
  }

  if (schema.type === "array") {
    const itemsZod = schema.items ? openApiTypeToZod(schema.items, spec) : "z.any()";
    return `z.array(${itemsZod})`;
  }

  if (schema.type === "object") {
    if (schema.additionalProperties) {
      const valueZod = openApiTypeToZod(schema.additionalProperties, spec);
      return `z.record(z.string(), ${valueZod})`;
    }
    return "z.record(z.string(), z.unknown())";
  }

  if (schema.enum) {
    const enumValues = schema.enum.map((e: any) => `"${e}"`).join(", ");
    return `z.enum([${enumValues}])`;
  }

  switch (schema.type) {
    case "string": {
      let zod = "z.string()";
      if (schema.minLength) {
        zod += `.min(${schema.minLength})`;
      }
      if (schema.maxLength) {
        zod += `.max(${schema.maxLength})`;
      }
      if (schema.pattern) {
        zod += `.regex(/${schema.pattern}/)`;
      }
      if (schema.format === "email") {
        zod = 'z.string().email(getValidationMessage("email"))';
      }
      return zod;
    }
    case "integer":
    case "number": {
      let zod = schema.type === "integer" ? "z.number().int()" : "z.number()";
      if (schema.minimum !== undefined) {
        zod += `.min(${schema.minimum})`;
      }
      if (schema.maximum !== undefined) {
        zod += `.max(${schema.maximum})`;
      }
      return zod;
    }
    case "boolean":
      return "z.boolean()";
    default:
      return "z.unknown()";
  }
}

/**
 * normalize a domain name to kebab-case
 */
export function normalizeDomainName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * collect schema names referenced by the given paths
 */
export function getReferencedSchemas(
  spec: OpenAPISpec,
  paths: Record<string, any>
): Set<string> {
  const schemas = new Set<string>();
  const visited = new Set<string>();

  function collectRefs(obj: any): void {
    if (!obj || typeof obj !== "object") {
      return;
    }

    if (obj.$ref && typeof obj.$ref === "string") {
      if (obj.$ref.startsWith("#/components/schemas/")) {
        const schemaName = obj.$ref.split("/").pop();
        if (schemaName && !visited.has(obj.$ref)) {
          visited.add(obj.$ref);
          schemas.add(schemaName);
          try {
            const resolved = resolveRef(spec, obj.$ref);
            collectRefs(resolved);
          } catch (e) {
            // ignore circular references
          }
        }
      }
      return;
    }

    if (Array.isArray(obj)) {
      obj.forEach(collectRefs);
    } else {
      Object.values(obj).forEach(collectRefs);
    }
  }

  Object.values(paths).forEach(collectRefs);
  return schemas;
}

/**
 * short hash of an object, used to detect document changes
 */
export function calculateHash(obj: any): string {
  const str = JSON.stringify(obj, Object.keys(obj).sort((a, b) => a.localeCompare(b)));
  return crypto.createHash("sha256").update(str).digest("hex").slice(0, 16);
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function writeJsonFile(filePath: string, data: any): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function readJsonFile(filePath: string): any {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const content = fs.readFileSync(filePath, "utf8");
  return JSON.parse(content);
}

export function specFilePath(): string {
  return path.join(process.cwd(), "openapi", "api-docs.json");
}
