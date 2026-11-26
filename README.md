# openapi-reference

Fetch OpenAPI documents from one or more services, split each by tag, optionally generate TypeScript types, and track changes between fetches.

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
    types: true
  - url: "http://localhost:8081/v3/api-docs"
    # name is optional; derived from info.title on fetch when omitted
    # types defaults to false
```

Each service is written under `openapi/{service-name}/`:

```
openapi/
  examinations/
    service.json
    api-docs.json
    domains/
    types/          # only when types: true
    .cache/
```

If `name` is omitted, the folder uses a kebab-case version of `info.title`. If the document has no title, `name` is required.

Set `types: true` on a service to generate TypeScript types. Default is `false`.

## Commands

```bash
npx openapi-reference fetch
npx openapi-reference parse
npx openapi-reference split
npx openapi-reference types
npx openapi-reference changes
npx openapi-reference all
```

Every command runs for all configured services. Pass a service name to target one:

```bash
npx openapi-reference all examinations
npx openapi-reference fetch examinations
```

`all` runs fetch, parse, split, then changes per selected service. Types run only for services with `types: true`.
