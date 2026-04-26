# Traseq Docs

This repository is the canonical Mintlify source for Traseq public docs.

## What is included

- `docs.json` with four top-level tabs
- English and `zh-Hant` navigation via `navigation.languages`
- Landing pages, API narrative docs, reference, and changelog entry points
- Core onboarding, tutorial, and workspace guide pages
- Repo-native custom JS/CSS for consent-gated docs analytics and selected article-page session replay
- A backend-exported OpenAPI document at `openapi/traseq-public-agent.json`
- A backend check/export flow plus GitHub Actions verification

## Backend sync workflow

Generate the OpenAPI file from the backend:

```bash
cd /Users/cjmario/M14R10/traseq/services/app-api
pnpm run export:public-openapi
```

Verify the checked-in spec is up to date:

```bash
cd /Users/cjmario/M14R10/traseq/services/app-api
pnpm run check:public-openapi
```

## Local preview

1. Install the Mintlify CLI:

```bash
npm i -g mint
```

2. Start the preview server from this directory:

```bash
cd /Users/cjmario/M14R10/traseq/docs/public-docs
mint dev
```

3. Open `http://localhost:3000`.

Local preview includes the docs consent UI, but GA4 event delivery is restricted to the production docs host. Docs-side Clarity session replay also requires a configured `CLARITY_PROJECT_ID` near the top of `traseq-public-analytics.js` and only activates on selected article-style pages.

## What is not included yet

- Full product/reference parity beyond the current migrated batch
- Brand assets and custom domain settings 
