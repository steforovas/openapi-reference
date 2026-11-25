import * as fs from "fs";
import * as path from "path";
import {
  loadOpenApiConfig,
  calculateHash,
  ensureDir,
  writeJsonFile,
  readJsonFile,
  OpenAPISpec,
} from "./utils";
import { loadOpenApiSpec } from "./fetch";

export interface ChangeReport {
  timestamp: string;
  hash: string;
  previousHash: string | null;
  changes: {
    newEndpoints: string[];
    removedEndpoints: string[];
    modifiedEndpoints: string[];
    newSchemas: string[];
    removedSchemas: string[];
    modifiedSchemas: string[];
    newTags: string[];
    removedTags: string[];
  };
}

function getEndpoints(spec: OpenAPISpec): Set<string> {
  const endpoints = new Set<string>();
  for (const [path, pathItem] of Object.entries(spec.paths)) {
    if (!pathItem || typeof pathItem !== "object") {
      continue;
    }
    for (const method of ["get", "post", "put", "delete", "patch"]) {
      if (pathItem[method]) {
        endpoints.add(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  return endpoints;
}

function getSchemas(spec: OpenAPISpec): Set<string> {
  return new Set(spec.components?.schemas ? Object.keys(spec.components.schemas) : []);
}

function getTags(spec: OpenAPISpec): Set<string> {
  return new Set(spec.tags?.map((t) => t.name) || []);
}

function schemaChanged(oldSchema: any, newSchema: any): boolean {
  if (!oldSchema || !newSchema) {
    return true;
  }

  const oldProps = oldSchema.properties || {};
  const newProps = newSchema.properties || {};
  const oldPropKeys = new Set(Object.keys(oldProps));
  const newPropKeys = new Set(Object.keys(newProps));

  if (oldPropKeys.size !== newPropKeys.size) {
    return true;
  }
  for (const key of Array.from(oldPropKeys)) {
    if (!newPropKeys.has(key)) {
      return true;
    }
  }
  for (const key of Array.from(newPropKeys)) {
    if (!oldPropKeys.has(key)) {
      return true;
    }
  }

  const oldRequired = new Set(oldSchema.required || []);
  const newRequired = new Set(newSchema.required || []);
  if (oldRequired.size !== newRequired.size) {
    return true;
  }
  for (const req of Array.from(oldRequired)) {
    if (!newRequired.has(req)) {
      return true;
    }
  }

  return false;
}

/**
 * compare the current document with the last cached copy
 */
export function trackChanges(): ChangeReport | null {
  const config = loadOpenApiConfig();
  const currentSpec = loadOpenApiSpec();
  const currentHash = calculateHash(currentSpec);

  const cacheDir = path.resolve(process.cwd(), config.cacheDir as string);
  ensureDir(cacheDir);

  const cacheFiles = fs
    .readdirSync(cacheDir)
    .filter((f) => f.startsWith("api-docs-") && f.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b))
    .reverse();

  let previousSpec: OpenAPISpec | null = null;
  let previousHash: string | null = null;

  if (cacheFiles.length > 0) {
    const latestCache = path.join(cacheDir, cacheFiles[0]);
    previousSpec = readJsonFile(latestCache);
    if (previousSpec) {
      previousHash = calculateHash(previousSpec);
    }
  }

  if (previousHash === currentHash) {
    console.log("No changes detected");
    return null;
  }

  console.log(`\nTracking changes...`);
  console.log(`   Current hash: ${currentHash}`);
  console.log(`   Previous hash: ${previousHash || "none"}`);

  const changes: ChangeReport["changes"] = {
    newEndpoints: [],
    removedEndpoints: [],
    modifiedEndpoints: [],
    newSchemas: [],
    removedSchemas: [],
    modifiedSchemas: [],
    newTags: [],
    removedTags: [],
  };

  if (!previousSpec) {
    console.log("   No previous version found, treating all as new");
    changes.newEndpoints = Array.from(getEndpoints(currentSpec));
    changes.newSchemas = Array.from(getSchemas(currentSpec));
    changes.newTags = Array.from(getTags(currentSpec));
  } else {
    const currentEndpoints = getEndpoints(currentSpec);
    const previousEndpoints = getEndpoints(previousSpec);

    for (const endpoint of Array.from(currentEndpoints)) {
      if (!previousEndpoints.has(endpoint)) {
        changes.newEndpoints.push(endpoint);
      }
    }

    for (const endpoint of Array.from(previousEndpoints)) {
      if (!currentEndpoints.has(endpoint)) {
        changes.removedEndpoints.push(endpoint);
      }
    }

    const currentSchemas = getSchemas(currentSpec);
    const previousSchemas = getSchemas(previousSpec);

    for (const schemaName of Array.from(currentSchemas)) {
      if (!previousSchemas.has(schemaName)) {
        changes.newSchemas.push(schemaName);
      } else {
        const oldSchema = previousSpec.components?.schemas?.[schemaName];
        const newSchema = currentSpec.components?.schemas?.[schemaName];
        if (schemaChanged(oldSchema, newSchema)) {
          changes.modifiedSchemas.push(schemaName);
        }
      }
    }

    for (const schemaName of Array.from(previousSchemas)) {
      if (!currentSchemas.has(schemaName)) {
        changes.removedSchemas.push(schemaName);
      }
    }

    const currentTags = getTags(currentSpec);
    const previousTags = getTags(previousSpec);

    for (const tag of Array.from(currentTags)) {
      if (!previousTags.has(tag)) {
        changes.newTags.push(tag);
      }
    }

    for (const tag of Array.from(previousTags)) {
      if (!currentTags.has(tag)) {
        changes.removedTags.push(tag);
      }
    }
  }

  const report: ChangeReport = {
    timestamp: new Date().toISOString(),
    hash: currentHash,
    previousHash,
    changes,
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(cacheDir, `changes-${timestamp}.json`);
  writeJsonFile(reportPath, report);

  const cachePath = path.join(cacheDir, `api-docs-${currentHash}.json`);
  writeJsonFile(cachePath, currentSpec);

  console.log(`\nChange summary:`);
  console.log(`   New endpoints: ${changes.newEndpoints.length}`);
  console.log(`   Removed endpoints: ${changes.removedEndpoints.length}`);
  console.log(`   Modified endpoints: ${changes.modifiedEndpoints.length}`);
  console.log(`   New schemas: ${changes.newSchemas.length}`);
  console.log(`   Removed schemas: ${changes.removedSchemas.length}`);
  console.log(`   Modified schemas: ${changes.modifiedSchemas.length}`);
  console.log(`   New tags: ${changes.newTags.length}`);
  console.log(`   Removed tags: ${changes.removedTags.length}`);
  console.log(`\n   Report saved to: ${reportPath}`);
  console.log(`   Cache saved to: ${cachePath}`);

  return report;
}
