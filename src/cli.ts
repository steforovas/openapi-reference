#!/usr/bin/env node

import { fetchAllServices, fetchService } from "./fetch";
import { parseAllServices, parseOpenApiSpec } from "./parse";
import { splitAllServices, splitByDomains } from "./split";
import { generateAllTypes, generateTypes } from "./generate-types";
import { trackAllChanges, trackChanges } from "./track-changes";
import { loadOpenApiConfig, resolveServiceName } from "./utils";

const commands: Record<string, () => Promise<unknown> | unknown> = {
  fetch: () => fetchAllServices(),
  parse: () => {
    parseAllServices();
  },
  split: () => {
    splitAllServices();
  },
  types: () => {
    generateAllTypes();
  },
  changes: () => {
    trackAllChanges();
  },
  all: async () => {
    const config = loadOpenApiConfig();
    for (const service of config.services) {
      await fetchService(service);
      const name = resolveServiceName(service);
      parseOpenApiSpec(name);
      splitByDomains(name);
      generateTypes(name);
      trackChanges(name);
    }
  },
};

async function main(): Promise<void> {
  const command = process.argv[2] || "all";
  const run = commands[command];

  if (!run) {
    console.error(
      `Unknown command '${command}'. Use fetch, parse, split, types, changes, or all.`
    );
    process.exit(1);
  }

  await run();
}

main().catch((error: any) => {
  console.error(error.message || error);
  process.exit(1);
});
