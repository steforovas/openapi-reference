# openapi-reference

Fetch an OpenAPI document, split it by tag, generate TypeScript types, and track changes between fetches.

Copy `openapi-config.example.yaml` to `openapi-config.yaml` in the project you run the command from.

```yaml
openapiUrl: "http://localhost:8080/v3/api-docs"
outputDir: "./openapi/domains"
typesOutputDir: "./openapi/types"
cacheDir: "./openapi/.cache"
```

```bash
npx openapi-reference fetch
npx openapi-reference parse
npx openapi-reference split
npx openapi-reference types
npx openapi-reference changes
npx openapi-reference all
```

`all` runs fetch, parse, split, types, then changes. The fetched document is written to `openapi/api-docs.json`.
