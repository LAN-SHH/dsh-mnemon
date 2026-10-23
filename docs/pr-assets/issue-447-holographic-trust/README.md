# Holographic trust from importance — issue #447

[简体中文](./README.zh-CN.md) | [Issue #447](https://github.com/omdsh-dev/dsh-mnemon/issues/447) | [Verification record](./verification.json)

Issue #447 reports that Holographic turns the 1-5 `importance` of `mnemon_remember` into its 0-1 trust by clamping, so
every fact's trust is 1.0, `defaultTrust` never applies and `minTrust` filters nothing.

Baseline: main `a7e3bc54`. The runs took place on 2026-10-23 (Asia/Shanghai) on macOS arm64 with Node 24.19.0 and pnpm
10.13.1. All memories are synthetic.

## Cause

- The Memory Spaces Source sends every Provider an integer importance from 1 to 5, and 3 when the writer gives none.
- Holographic stored `clampTrust(importance ?? defaultTrust)`. Any value from 1 to 5 clamps to 1.0, and since an
  importance always arrives, `defaultTrust` was never used.
- `minTrust` hides facts below it, but with every fact at 1.0 it hid nothing.
- Reading back, a fact reported its trust as its importance, so every Holographic memory showed importance 1.

## Fix

- **A new fact's trust.** Importance 3 starts at the space's `defaultTrust`. Each step above or below moves the trust
  by 0.1, within 0 to 1. With the defaults (0.5 and a minimum of 0.3), importance 1 to 5 start at 0.3 to 0.7, so every
  fact is still recalled until the minimum is raised. A fact that reaches the Provider without an importance starts at
  `defaultTrust`.
- **Search and related scores** stay the plain relevance. Trust only decides what is recalled. Scaling scores by the
  new, lower trusts would have pushed new facts under the recall tiers' 0.25 floor; today every fact scores at its
  relevance because its trust is 1.0, so this keeps every existing ranking exactly.
- **Importance is kept.** A fact keeps the importance it was written with and reads back with it, on the 1-5 scale
  every Provider reports.
- **Existing facts are left as they are.** They keep trust 1.0 and have no recorded importance; their original
  importance was lost to the clamp. Rewriting them would guess at user data, and leaving them visible is the behavior
  users have today. They read back without an importance rather than with a wrong one.
- **One importance scale.** The extensions guide now states it for every Provider: the Source sends 1-5, and a backend
  with another scale maps onto it instead of passing or clamping the number.

## Through the Memory Spaces Source

[`trust.probe.mjs`](./trust.probe.mjs) mounts the real Memory Spaces Source with the Holographic Provider. It writes
three memories through `remember` and reads the local store. It then searches with the space's minimum trust at 0.3,
and again at 0.5.

| Memory | importance sent | main: trust / read back | Fix: trust / read back |
|---|---|---|---|
| Release notes are drafted on Monday | 1 | 1 / 1 | 0.3 / 1 |
| Release approvals need a completed canary | 5 | 1 / 1 | 0.7 / 5 |
| Release branches are cut from main | none (Source sends 3) | 1 / 1 | 0.5 / 3 |

| Search "release" | main | Fix |
|---|---|---|
| `minTrust` 0.3 | all three, score 0.9 | all three, score 0.9 |
| `minTrust` 0.5 | all three, score 0.9 | importance 5 and 3, score 0.9 |

## Other Providers

- **Unchanged and consistent with the 1-5 scale:** Mnemon Native passes the importance to the CLI. OpenViking tags it.
  Mem0 and Supermemory pass it as given.
- **Not sent at all:** Hindsight, Honcho and ByteRover do not send an importance.
- **RetainDB** sends `importance: request.importance ?? 0.7`. Because the Source always sends 1-5, the 0.7 default
  never applies, and the default suggests RetainDB's API uses 0-1. It was not verified against a RetainDB server, so it
  is reported here and not changed.

## Automated checks

```text
pnpm --filter dsh-mnemon-provider-holographic exec vitest run    # 12 passed; on main, 3 of the new tests fail
pnpm --filter dsh-mnemon-provider-holographic run typecheck
pnpm --filter dsh-mnemon-provider-holographic run build
pnpm exec vitest run <the 9 root test files that exercise Holographic>   # 441 passed, 1 skipped
pnpm --filter dsh-mnemon-source-memory-spaces exec vitest run    # 296 passed, 2 skipped
node docs/pr-assets/issue-447-holographic-trust/trust.probe.mjs <out.json>
node scripts/verify-docs.mjs
```

The new unit tests cover:

- the mapping from importance to trust, including the clamp at 1;
- the default trust;
- `minTrust` set between two importances;
- a relevance score that trust does not reduce;
- a fact written before the fix that is left as it was.
