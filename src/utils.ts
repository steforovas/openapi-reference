import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import crypto from "crypto";

export interface ServiceConfig {
  url: string;
  name?: string;
  // when true, generate typescript types for this service (default false)
  types?: boolean;
}

export interface OpenApiConfig {
  services: ServiceConfig[];
}

export interface ServiceMeta {
  url: string;
  name: string;
}

export interface ServicePaths {
  root: string;
  spec: string;
  domains: string;
  types: string;
  cache: string;
  meta: string;
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

export function openapiRoot(): string {
  return path.join(process.cwd(), "openapi");
}

/**
 * paths for one service under openapi/{serviceName}/
 */
export function servicePaths(serviceName: string): ServicePaths {
  const root = path.join(openapiRoot(), serviceName);
  return {
    root,
    spec: path.join(root, "api-docs.json"),
    domains: path.join(root, "domains"),
    types: path.join(root, "types"),
    cache: path.join(root, ".cache"),
    meta: path.join(root, "service.json"),
  };
}

/**
 * load openapi-config.yaml from the current working directory
 */
export function loadOpenApiConfig(): OpenApiConfig {
  const configPath = path.join(process.cwd(), "openapi-config.yaml");

  if (!fs.existsSync(configPath)) {
    throw new Error(
      "openapi-config.yaml not found in project root. Please create it with a services list."
    );
  }

  const configContent = fs.readFileSync(configPath, "utf8");
  const config = yaml.load(configContent) as OpenApiConfig;

  if (!config.services || !Array.isArray(config.services) || config.services.length === 0) {
    throw new Error("services is required in openapi-config.yaml and must be a non-empty list");
  }

  for (const [index, service] of config.services.entries()) {
    if (!service || typeof service !== "object" || !service.url) {
      throw new Error(`services[${index}].url is required in openapi-config.yaml`);
    }
    service.types = service.types === true;
  }

  return config;
}

export function serviceWantsTypes(service: ServiceConfig): boolean {
  return service.types === true;
}

/**
 * return configured services, optionally filtered by service name
 */
export function selectServices(serviceFilter?: string): ServiceConfig[] {
  const config = loadOpenApiConfig();
  if (!serviceFilter) {
    return config.services;
  }

  const normalized = normalizeDomainName(serviceFilter);
  if (!normalized) {
    throw new Error(`Invalid service name '${serviceFilter}'`);
  }

  const matched = config.services.filter((service) => {
    if (service.name && normalizeDomainName(service.name) === normalized) {
      return true;
    }

    try {
      return resolveServiceName(service) === normalized;
    } catch {
      return false;
    }
  });

  if (matched.length === 0) {
    throw new Error(
      `No service named '${serviceFilter}' found in openapi-config.yaml.\n` +
        `Use a configured name, or a previously fetched service folder name.`
    );
  }

  return matched;
}

/**
 * find a previously fetched service folder by matching url in service.json
 */
export function findServiceNameByUrl(url: string): string | null {
  const root = openapiRoot();
  if (!fs.existsSync(root)) {
    return null;
  }

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const metaPath = path.join(root, entry.name, "service.json");
    if (!fs.existsSync(metaPath)) {
      continue;
    }

    const meta = readJsonFile(metaPath) as ServiceMeta | null;
    if (meta?.url === url) {
      return meta.name || entry.name;
    }
  }

  return null;
}

/**
 * resolve service folder name from config or a previous fetch
 */
export function resolveServiceName(service: ServiceConfig): string {
  if (service.name) {
    const name = normalizeDomainName(service.name);
    if (!name) {
      throw new Error(`Invalid service name '${service.name}'`);
    }
    return name;
  }

  const found = findServiceNameByUrl(service.url);
  if (found) {
    return found;
  }

  throw new Error(
    `Service name not found for ${service.url}.\n` +
      `Run 'openapi-reference fetch' first, or set name in openapi-config.yaml.`
  );
}

/**
 * resolve service name from config or the fetched document title
 */
export function resolveServiceNameFromSpec(
  service: ServiceConfig,
  spec: OpenAPISpec
): string {
  if (service.name) {
    const name = normalizeDomainName(service.name);
    if (!name) {
      throw new Error(`Invalid service name '${service.name}'`);
    }
    return name;
  }

  const title = spec.info?.title;
  if (!title) {
    throw new Error(
      `name is required for ${service.url} when the OpenAPI document has no info.title`
    );
  }

  const name = normalizeDomainName(title);
  if (!name) {
    throw new Error(
      `Could not derive a service name from info.title '${title}'. Set name in openapi-config.yaml.`
    );
  }

  return name;
}

/**
 * fail when another service already owns this folder name
 */
export function assertServiceNameAvailable(serviceName: string, url: string): void {
  const paths = servicePaths(serviceName);
  if (!fs.existsSync(paths.meta)) {
    return;
  }

  const meta = readJsonFile(paths.meta) as ServiceMeta | null;
  if (meta?.url && meta.url !== url) {
    throw new Error(
      `Service folder '${serviceName}' is already used by ${meta.url}. Choose a different name.`
    );
  }
}

export function writeServiceMeta(serviceName: string, url: string): void {
  writeJsonFile(servicePaths(serviceName).meta, { url, name: serviceName });
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

/**
 * create a cache directory and keep its contents out of git
 */
export function ensureIgnoredCache(cacheDir: string): void {
  ensureDir(cacheDir);
  const gitignorePath = path.join(cacheDir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, "*\n", "utf8");
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
