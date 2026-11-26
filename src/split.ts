import * as path from "path";
import { parseOpenApiSpec } from "./parse";
import { resolveConfiguredServices } from "./fetch";
import {
  normalizeDomainName,
  getReferencedSchemas,
  resolveSchema,
  ensureDir,
  writeJsonFile,
  DomainData,
  servicePaths,
} from "./utils";

/**
 * split every configured service by tags (or one service when filtered)
 */
export function splitAllServices(serviceFilter?: string): void {
  for (const { name } of resolveConfiguredServices(serviceFilter)) {
    splitByDomains(name);
  }
}

/**
 * split the document into one file per tag for one service
 */
export function splitByDomains(serviceName: string): Map<string, DomainData> {
  const parsed = parseOpenApiSpec(serviceName);
  const spec = parsed.spec;
  const domains = new Map<string, DomainData>();

  const outputDir = servicePaths(serviceName).domains;
  ensureDir(outputDir);

  console.log(`\nSplitting OpenAPI document by tags (${serviceName})...`);

  for (const [tagName, tagInfo] of Array.from(parsed.tags.entries())) {
    const domainName = normalizeDomainName(tagName);
    const paths = parsed.pathsByTag.get(tagName) || [];

    if (paths.length === 0) {
      console.log(`   Skipping tag '${tagName}' (no paths)`);
      continue;
    }

    const domainPaths: Record<string, any> = {};
    for (const pathKey of Array.from(paths)) {
      if (spec.paths[pathKey]) {
        domainPaths[pathKey] = spec.paths[pathKey];
      }
    }

    const referencedSchemaNames = getReferencedSchemas(spec, domainPaths);

    const domainSchemas: Record<string, any> = {};
    if (spec.components?.schemas) {
      for (const schemaName of Array.from(referencedSchemaNames)) {
        if (spec.components.schemas[schemaName]) {
          try {
            domainSchemas[schemaName] = resolveSchema(spec, spec.components.schemas[schemaName]);
          } catch (error: any) {
            console.warn(
              `   Warning: Could not resolve schema '${schemaName}': ${error.message}`
            );
            domainSchemas[schemaName] = spec.components.schemas[schemaName];
          }
        }
      }
    }

    const domainData: DomainData = {
      tag: tagName,
      description: tagInfo.description,
      paths: domainPaths,
      schemas: domainSchemas,
    };

    domains.set(domainName, domainData);

    const domainFilePath = path.join(outputDir, `${domainName}.json`);
    writeJsonFile(domainFilePath, {
      domain: {
        name: domainName,
        tag: tagName,
        description: tagInfo.description,
      },
      paths: domainPaths,
      schemas: domainSchemas,
    });

    console.log(
      `   ${domainName}: ${paths.length} paths, ${referencedSchemaNames.size} schemas`
    );
  }

  console.log(`\nSplit completed: ${domains.size} domains`);
  console.log(`   Output directory: ${outputDir}`);

  return domains;
}
