import * as fs from "fs";
import * as path from "path";
import { splitByDomains } from "./split";
import {
  openApiTypeToTypeScript,
  ensureDir,
  OpenAPISpec,
  servicePaths,
  serviceWantsTypes,
} from "./utils";
import { loadOpenApiSpec, resolveConfiguredServices } from "./fetch";

function generateInterface(schemaName: string, schema: any, spec: OpenAPISpec): string {
  const lines: string[] = [];

  if (schema.description) {
    lines.push("/**");
    lines.push(` * ${schema.description.replace(/\n/g, "\n * ")}`);
    lines.push(" */");
  }

  const hasProperties = schema.properties && Object.keys(schema.properties).length > 0;
  const hasAdditionalProperties = schema.type === "object" && schema.additionalProperties;

  if (!hasProperties && !hasAdditionalProperties) {
    lines.push(`export type ${schemaName} = Record<string, unknown>;`);
    return lines.join("\n");
  }

  lines.push(`export interface ${schemaName} {`);

  if (hasProperties) {
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      const prop = propSchema as any;
      const isRequired = schema.required?.includes(propName);
      const optional = isRequired ? "" : "?";
      const type = openApiTypeToTypeScript(prop, spec);

      if (prop.description) {
        lines.push(`  /**`);
        lines.push(`   * ${prop.description.replace(/\n/g, "\n   * ")}`);
        lines.push(`   */`);
      }

      lines.push(`  ${propName}${optional}: ${type};`);
    }
  } else if (hasAdditionalProperties) {
    const valueType = openApiTypeToTypeScript(schema.additionalProperties, spec);
    lines.push(`  [key: string]: ${valueType};`);
  }

  lines.push("}");
  return lines.join("\n");
}

function generateDomainTypes(
  domainName: string,
  schemas: Record<string, any>,
  spec: OpenAPISpec
): string {
  const lines: string[] = [];

  lines.push(`// generated types for domain: ${domainName}`);
  lines.push(`// this file is auto-generated. do not edit manually.`);
  lines.push("");

  const schemaEntries = Object.entries(schemas).sort(([a], [b]) => a.localeCompare(b));

  for (const [schemaName, schema] of schemaEntries) {
    if (schema.$ref && typeof schema.$ref === "string") {
      const refName = schema.$ref.split("/").pop() || "";
      lines.push(`export type ${schemaName} = ${refName};`);
      lines.push("");
      continue;
    }

    if (schema.enum && schema.type === "string") {
      const enumValues = schema.enum.map((e: any) => `  "${e}"`).join(" |\n");
      if (schema.description) {
        lines.push("/**");
        lines.push(` * ${schema.description.replace(/\n/g, "\n * ")}`);
        lines.push(" */");
      }
      lines.push(`export type ${schemaName} =\n${enumValues};`);
      lines.push("");
      continue;
    }

    if (schema.oneOf || schema.anyOf) {
      const types = (schema.oneOf || schema.anyOf).map((s: any) =>
        openApiTypeToTypeScript(s, spec)
      );
      if (schema.description) {
        lines.push("/**");
        lines.push(` * ${schema.description.replace(/\n/g, "\n * ")}`);
        lines.push(" */");
      }
      lines.push(`export type ${schemaName} = ${types.join(" | ")};`);
      lines.push("");
      continue;
    }

    if (schema.allOf) {
      const types = schema.allOf.map((s: any) => openApiTypeToTypeScript(s, spec));
      if (schema.description) {
        lines.push("/**");
        lines.push(` * ${schema.description.replace(/\n/g, "\n * ")}`);
        lines.push(" */");
      }
      lines.push(`export type ${schemaName} = ${types.join(" & ")};`);
      lines.push("");
      continue;
    }

    lines.push(generateInterface(schemaName, schema, spec));
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * write typescript types for services with types: true (or one when filtered)
 */
export function generateAllTypes(serviceFilter?: string): void {
  const services = resolveConfiguredServices(serviceFilter).filter(({ service }) =>
    serviceWantsTypes(service)
  );

  if (services.length === 0) {
    if (serviceFilter) {
      throw new Error(
        `Service '${serviceFilter}' does not have types: true in openapi-config.yaml`
      );
    }
    console.log("Skipping TypeScript generation: no services have types: true");
    return;
  }

  for (const { name } of services) {
    generateTypes(name);
  }
}

/**
 * write typescript types for every domain of one service
 */
export function generateTypes(serviceName: string): void {
  const spec = loadOpenApiSpec(serviceName);
  const domains = splitByDomains(serviceName);

  const outputDir = servicePaths(serviceName).types;
  ensureDir(outputDir);

  console.log(`\nGenerating TypeScript types (${serviceName})...`);

  let totalTypes = 0;

  for (const [domainName, domainData] of Array.from(domains.entries())) {
    if (Object.keys(domainData.schemas).length === 0) {
      console.log(`   Skipping ${domainName} (no schemas)`);
      continue;
    }

    const typesContent = generateDomainTypes(domainName, domainData.schemas, spec);
    const outputPath = path.join(outputDir, `${domainName}.ts`);
    fs.writeFileSync(outputPath, typesContent, "utf8");

    const schemaCount = Object.keys(domainData.schemas).length;
    totalTypes += schemaCount;
    console.log(`   ${domainName}: ${schemaCount} types`);
  }

  const indexLines: string[] = [];
  indexLines.push("// auto-generated index file");
  indexLines.push("");

  for (const domainName of Array.from(domains.keys())) {
    indexLines.push(`export * from "./${domainName}";`);
  }

  const indexPath = path.join(outputDir, "index.ts");
  fs.writeFileSync(indexPath, indexLines.join("\n") + "\n", "utf8");

  console.log(`\nTypes written: ${totalTypes}`);
  console.log(`   Output directory: ${outputDir}`);
}
