#!/usr/bin/env node

import { fetchAllServices, fetchService } from "./fetch";
import { parseAllServices, parseOpenApiSpec } from "./parse";
import { splitAllServices, splitByDomains } from "./split";
import { generateAllTypes, generateTypes } from "./generate-types";
import { trackAllChanges, trackChanges } from "./track-changes";
import { resolveServiceName, selectServices, serviceWantsTypes } from "./utils";

async function runAll(serviceFilter?: string): Promise<void> {
  for (const service of selectServices(serviceFilter)) {
    await fetchService(service);
    const name = resolveServiceName(service);
    parseOpenApiSpec(name);
    splitByDomains(name);
    if (serviceWantsTypes(service)) {
      generateTypes(name);
    }
    trackChanges(name);
  }
}

const commands: Record<string, (serviceFilter?: string) => Promise<unknown> | unknown> = {
  fetch: (serviceFilter) => fetchAllServices(serviceFilter),
  parse: (serviceFilter) => {
    parseAllServices(serviceFilter);
  },
  split: (serviceFilter) => {
    splitAllServices(serviceFilter);
  },
  types: (serviceFilter) => {
    generateAllTypes(serviceFilter);
  },
  changes: (serviceFilter) => {
    trackAllChanges(serviceFilter);
  },
  all: (serviceFilter) => runAll(serviceFilter),
};

async function main(): Promise<void> {
  const command = process.argv[2] || "all";
  const serviceFilter = process.argv[3];
  const run = commands[command];

  if (!run) {
    console.error(
      `Unknown command '${command}'. Use fetch, parse, split, types, changes, or all.`
    );
    process.exit(1);
  }

  await run(serviceFilter);
}

main().catch((error: any) => {
  console.error(error.message || error);
  process.exit(1);
});
