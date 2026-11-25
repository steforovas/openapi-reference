#!/usr/bin/env node

import { fetchOpenApiSpec } from "./fetch";
import { parseOpenApiSpec } from "./parse";
import { splitByDomains } from "./split";
import { generateTypes } from "./generate-types";
import { trackChanges } from "./track-changes";

const commands: Record<string, () => Promise<unknown> | unknown> = {
  fetch: () => fetchOpenApiSpec(),
  parse: () => {
    parseOpenApiSpec();
  },
  split: () => {
    splitByDomains();
  },
  types: () => {
    generateTypes();
  },
  changes: () => {
    trackChanges();
  },
  all: async () => {
    await fetchOpenApiSpec();
    parseOpenApiSpec();
    splitByDomains();
    generateTypes();
    trackChanges();
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
