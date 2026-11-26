# openapi-reference

Fetch OpenAPI documents from one or more services, split each by tag, generate TypeScript types, and track changes between fetches.

## Setup

```bash
npm install -D openapi-reference
cp node_modules/openapi-reference/openapi-config.example.yaml ./openapi-config.yaml
```

Edit `openapi-config.yaml`:

```yaml
services:
  - url: "http://localhost:8080/v3/api-docs"
    name: examinations
  - url: "http://localhost:8081/v3/api-docs"
    # name is optional; derived from info.title on fetch when omitted
```

Each service is written under `openapi/{service-name}/`:

```
openapi/
  examinations/
    service.json
    api-docs.json
    domains/
    types/
    .cache/
```

If `name` is omitted, the folder uses a kebab-case version of `info.title`. If the document has no title, `name` is required.

## Commands

```bash
npx openapi-reference fetch
npx openapi-reference parse
npx openapi-reference split
npx openapi-reference types
npx openapi-reference changes
npx openapi-reference all
```

Every command runs for all configured services. `all` runs fetch, parse, split, types, then changes per service.
