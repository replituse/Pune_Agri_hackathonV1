# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

### AgriAdmin AI — Smart Agriculture Dashboard (`artifacts/agri-admin`)

- **Type**: React + Vite frontend-only app (no backend/auth)
- **Preview path**: `/`
- **Description**: AI-powered agriculture administration dashboard for government district officers
- **Source**: Migrated from Lovable.dev (original files in `.migration-backup/`)
- **Tech**: React 18, react-router-dom, Tailwind v3, shadcn/ui, Recharts, DM Sans/DM Serif Display fonts
- **Data**: All data is static/dummy from `src/data/dummyData.ts`
- **Key screens**: Dashboard, New Registration (OCR), Farmer Registry, Scheme Applications, Subsidy Management, Insurance Claims, Grievance Management, Reports & Analytics, Settings & Workflow, Farmer App Preview
- **New Registration module**: 5 document upload cards (Form 7, Form 12, Form 8A, Aadhaar, Bank Passbook); uploads to `/api/extract`, polls `/api/extract/:requestId`, displays structured extracted fields, auto-saves to MongoDB profile when phone number is provided
- **AI Assistant**: Floating chat widget (purely frontend, no real API calls)
- **No Supabase**: Original Lovable app had no Supabase usage — pure frontend migration

### API Server (`artifacts/api-server`)
- **Type**: Express API server
- **Preview path**: `/api`
- **New Registration OCR routes**:
  - `GET /api/document-types` — list all 5 supported document types
  - `POST /api/extract` — upload file (multipart: `file`, `document_type`, `mode`, optional `profile_phone`); fans out to Datalab Extract + Marker pipelines; returns `request_id`
  - `GET /api/extract/:requestId` — poll for extraction result; when complete, returns `structured` fields + auto-saves to MongoDB if `profile_phone` was provided
- **MongoDB**: Connected to Atlas cluster (`apnaapp` DB, `users` collection); auto-saves extracted document data as sub-documents keyed by section (`aadhar`, `passbook`, `form7`, `form12`, `form8a`)
- **Secrets required**: `DATALAB_API_KEY`, `MONGODB_URI`
- **New deps**: `mongodb`, `multer`, `@types/multer`

### Canvas / Mockup Sandbox (`artifacts/mockup-sandbox`)
- **Type**: Design mockup sandbox (pre-existing scaffold)
- **Preview path**: `/__mockup`
