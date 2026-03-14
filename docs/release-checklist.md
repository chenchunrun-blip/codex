# Release Checklist

Use this checklist before merging to `main` or cutting a release build.

Recommended default command before any manual checks:

```bash
npm run verify:mainline
```

## 1. Local Core Verification

Run local quality gates:

```bash
npm run verify:mainline
npm run verify:core
```

`verify:mainline` includes:
- Review queue E2E (`npm run test:e2e:review`)
- Workspace core E2E (`npm run test:e2e:workspace`)
- Team rollout E2E (`npm run test:e2e:team`)
- Collaboration core E2E (`e2e/collab-core-flow.spec.ts`)

`verify:core` includes:
- TypeScript type checking (`npm run typecheck`)
- Core unit regression suite (`npm run test:unit:core`)
- Smoke E2E suite (`npm run test:e2e:smoke`)

## 2. Mainline Regression Sequence

Run workflow-critical E2E in this order:

```bash
npm run verify:mainline
npm run verify:extended
```

## 3. Database Readiness

Verify Prisma client and migrations:

```bash
npm run db:generate
npx prisma migrate status
```

If there are new schema changes, apply migration in target environment:

```bash
npx prisma migrate deploy
```

## 4. API Contract Spot Check

Validate key API paths from recent changes:
- `/api/tasks/*` (assignment, queue, status)
- `/api/operations/*` (status + health)
- `/api/reports/*` (history/export/save)
- `/api/templates/*` (catalog + starter packs)

## 5. UI Spot Check

Verify these pages in browser:
- `/tasks`
- `/reports`
- `/projects`
- `/teams`
- `/templates`
- `/files`

Check:
- Filter defaults are propagated into dialogs.
- Export/save flows show inline errors (no blocking alerts).
- Operations status/health panels render and refresh.

## 6. CI Status

Ensure `CI Core` workflow passed:
- PostgreSQL service boot
- Prisma generate + migrate
- `npm run verify:core`

And on `main`, verify grouped `verify-extended` jobs:
- `workspace` E2E
- `team rollout` E2E
- `review queue` E2E
- `collaboration core` E2E

## 7. Release Notes

Summarize:
- New capabilities
- Breaking changes (if any)
- Migration or env var requirements
- Known limitations
