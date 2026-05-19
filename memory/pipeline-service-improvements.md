---
name: Pipeline Service Production Improvements
description: Key production improvements made to pipeline.service.ts for resilience and monitoring
type: reference
---

**Pipeline Service Production Hardening** (2026-05-19)

Fixed critical issues in `src/services/pipeline.service.ts`:

**Why:** Original code had syntax errors (truncated lines), no retry/timeout logic, inconsistent error handling, and unstructured logging — not production-ready.

**How to apply:**
- All async operations now wrapped with `withRetry()` (exponential backoff) and `withTimeout()`
- Structured logging via `appLogger` (pino-based) replaces `console.log`
- Metrics tracking: totalRuns, successfulRuns, failedRuns, averageDuration, intentDistribution
- Pipeline metrics accessible via `pipelineService.getMetrics()`
- Validation added: `PipelineValidator.validatePlannerOutput()` for plan safety
- Error handling: graceful fallbacks in `handlePureChat()`, proper error propagation
- Fixed duplicate functions (moved to `pipeline-validator.util.ts`)
- TypeScript fixes: proper typing for `ToolParam[]`, array length checks

**Files modified:**
- `src/services/pipeline.service.ts` — complete rewrite with production features
- `src/utils/pipeline-validator.util.ts` — added `validatePlannerOutput()`, `validatePipelineInput()`
