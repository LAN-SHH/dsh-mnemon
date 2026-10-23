# RetainDB memory types RetainDB Server accepts

[简体中文](./README.zh-CN.md) | [Verification record](./verification.json)

This record is stacked on #462, which maps importance onto RetainDB's 0-1 scale
([its record](../retaindb-importance-scale/README.md)).

The RetainDB Provider sent the Memory Spaces category as RetainDB's `memory_type`
(`memory_type: request.category ?? 'factual'`). The Source always sends a category: `general` by default, and
`context` for Runtime and document archives (`src/host/runtime-capacity.ts`, `src/host/document-archive.ts`).

Baseline: `claude/fix-retaindb-importance-scale` at `c841066f` (#462). The runs took place on 2026-10-24
(Asia/Shanghai) on macOS arm64 with Node 24.19.0 and pnpm 10.13.1. All memories are synthetic.

The evidence:

- RetainDB's own source at `2ad2cc4d`;
- unit tests of the type the Provider sends to each endpoint;
- a replay of the exact bodies against RetainDB Server's own request schema;
- a live run against RetainDB Local 0.2.2 from the provider lab, before and after the fix.

No RetainDB Server and no hosted service was run. Cloud was not observed.

## RetainDB's types

Links point to [RetainDB/RetainDB](https://github.com/RetainDB/RetainDB) at `2ad2cc4d`.

- **`POST /v1/memory`** declares `memory_type: z.enum(MEMORY_TYPE_VALUES).optional()`
  ([`api/memory.ts:924`](https://github.com/RetainDB/RetainDB/blob/2ad2cc4d6d58145eca1a6cbbce66dfc5b5380f38/packages/server/src/api/memory.ts#L924)).
  - The list holds 16 types: `factual`, `episodic`, `semantic`, `procedural`, `preference`, `event`, `relationship`,
    `opinion`, `goal`, `instruction`, `decision`, `constraint`, `solution`, `project_state`, `correction` and `workflow`
    ([`:63-80`](https://github.com/RetainDB/RetainDB/blob/2ad2cc4d6d58145eca1a6cbbce66dfc5b5380f38/packages/server/src/api/memory.ts#L63-L80)).
  - It has no `general`, `fact`, `insight` or `context`.
  - `@hono/zod-validator` 0.4.3 answers a type outside the list with HTTP 400.
- **The legacy `POST /v1/memories`** declares
  `memory_type: z.enum(["factual", "episodic", "semantic", "procedural"]).optional().default("factual")`
  ([`api/routes.ts:2584`](https://github.com/RetainDB/RetainDB/blob/2ad2cc4d6d58145eca1a6cbbce66dfc5b5380f38/packages/server/src/api/routes.ts#L2584)).
- **The Server falls back to `factual`.** Its write path folds `semantic` into `factual`, `episodic` into `event` and
  `procedural` into `instruction`, and any other name into `factual`
  ([`engine/memory/write.ts:140-161`](https://github.com/RetainDB/RetainDB/blob/2ad2cc4d6d58145eca1a6cbbce66dfc5b5380f38/packages/server/src/engine/memory/write.ts#L140-L161),
  [`api/memory.ts:104-107`](https://github.com/RetainDB/RetainDB/blob/2ad2cc4d6d58145eca1a6cbbce66dfc5b5380f38/packages/server/src/api/memory.ts#L104-L107)).
- **RetainDB Local** takes any type. It infers a type from the text and otherwise falls back to the type it was sent,
  reading `fact` and any name it does not know as `factual`
  ([`local/src/cli.ts:173-201`](https://github.com/RetainDB/RetainDB/blob/2ad2cc4d6d58145eca1a6cbbce66dfc5b5380f38/packages/local/src/cli.ts#L173-L201),
  [`:302-316`](https://github.com/RetainDB/RetainDB/blob/2ad2cc4d6d58145eca1a6cbbce66dfc5b5380f38/packages/local/src/cli.ts#L302-L316)).

## Cause

The Provider sent the category itself. On RetainDB Server:

- `POST /v1/memory` refused every memory of category `fact`, `insight`, `context` or `general`, the Source's default
  included;
- the legacy endpoint refused every memory, since it takes none of the six category names.

With #462, `POST /v1/memory` still refused 12 of 18 category and importance combinations, and the legacy endpoint all
18.

## Fix

- On `POST /v1/memory`, `preference` and `decision` keep their names. `fact`, `insight`, `context` and `general` are
  sent as `factual`.
- The legacy `POST /v1/memories` receives `factual` for every category, since it takes no `preference` or `decision`.
- A request without a category is still sent as `factual` on both endpoints.
- `factual` is the type RetainDB Server and RetainDB Local fall back to themselves, and the type the Provider already
  sent when no category reached it.
- Reading back is unchanged.

## Against RetainDB Server's schema

[`server-schema.probe.mjs`](../retaindb-importance-scale/server-schema.probe.mjs), from #462's record, writes every
category at importance 1, 3 and 5 through the real Source and Provider to a loopback recorder. It runs once with
`POST /v1/memory` answered and once with it refused with 404, so that the Provider falls back to
`POST /v1/memories`. It then parses each body with the Server's own request schema for that endpoint. The table holds
for importance 1, 3 and 5 alike.

| Category | Type sent to `/v1/memory`, before → after | `/v1/memory` | Type sent to `/v1/memories`, before → after | `/v1/memories` |
|---|---|---|---|---|
| `preference` | `preference` → `preference` | accepted → accepted | `preference` → `factual` | 400 → accepted |
| `decision` | `decision` → `decision` | accepted → accepted | `decision` → `factual` | 400 → accepted |
| `fact` | `fact` → `factual` | 400 → accepted | `fact` → `factual` | 400 → accepted |
| `insight` | `insight` → `factual` | 400 → accepted | `insight` → `factual` | 400 → accepted |
| `context` | `context` → `factual` | 400 → accepted | `context` → `factual` | 400 → accepted |
| `general` | `general` → `factual` | 400 → accepted | `general` → `factual` | 400 → accepted |

| Endpoint | main | #462 | This fix |
|---|---|---|---|
| `POST /v1/memory` | 2 of 18 | 6 of 18 | 18 of 18 |
| `POST /v1/memories` (legacy) | 0 of 18 | 0 of 18 | 18 of 18 |

Every refusal before was for `memory_type`, and none is left.

## Against RetainDB Local

[`live-types.probe.mjs`](./live-types.probe.mjs) ran against RetainDB Local 0.2.2 from the provider lab: the
`retaindb` service in [`provider-lab/`](../../../provider-lab/README.md), with hash embeddings, on
`http://127.0.0.1:18990`. The container had been stopped. It was started for these runs, stopped again afterwards, and
its volume was kept.

Each run wrote every category at importance 1, 3 and 5 through the real Source, as user `rv462`, into a new project of
its own: `rv462-type-before` with #462's driver, `rv462-type-after` with the fix. The texts carry none of the words
RetainDB Local infers a type from, so it falls back to the type it was sent.

| Category | Type sent, before → after | Type stored, before and after | Importance stored for 1 / 3 / 5, before and after |
|---|---|---|---|
| `preference` | `preference` → `preference` | `preference` | 0.636 / 0.836 / 0.99 |
| `decision` | `decision` → `decision` | `decision` | 0.644 / 0.844 / 0.99 |
| `fact` | `fact` → `factual` | `factual` | 0.600 / 0.800 / 0.99 |
| `insight` | `insight` → `factual` | `factual` | 0.600 / 0.800 / 0.99 |
| `context` | `context` → `factual` | `factual` | 0.600 / 0.800 / 0.99 |
| `general` | `general` → `factual` | `factual` | 0.600 / 0.800 / 0.99 |

The stored type and importance are the same in both runs for all 18 memories. Only the type RetainDB Local records
as sent, `metadata.original_type`, changed.

## Reproduce

The after columns come from this branch after `pnpm build && pnpm -r build`. For the before columns, build the
Provider from #462's driver first, then restore it:

```text
git show claude/fix-retaindb-importance-scale:plugins/dsh-mnemon-provider-retaindb/src/driver.ts > plugins/dsh-mnemon-provider-retaindb/src/driver.ts
pnpm --filter dsh-mnemon-provider-retaindb run build
node docs/pr-assets/retaindb-importance-scale/server-schema.probe.mjs <before.json>
node docs/pr-assets/retaindb-memory-type/live-types.probe.mjs http://127.0.0.1:18990 rv462-type-before <before.json>
git checkout -- plugins/dsh-mnemon-provider-retaindb/src/driver.ts
pnpm --filter dsh-mnemon-provider-retaindb run build
```

Then run the same probes for the fix, with `rv462-type-after` for the live run.

```text
pnpm --filter dsh-mnemon-provider-retaindb exec vitest run     # 23 passed; on #462's driver, 6 of the 7 new tests fail
pnpm --filter dsh-mnemon-provider-retaindb run typecheck
pnpm --filter dsh-mnemon-provider-retaindb run build
pnpm --filter dsh-mnemon-source-memory-spaces exec vitest run  # 296 passed, 2 skipped
node scripts/verify-docs.mjs
```

The new unit tests check the type sent to each endpoint for every category, and for a request without one. On #462's
driver, the test without a category passes, because the Provider already sent `factual` then. The other six fail.

## Limits

- No RetainDB Server and no hosted service was run. The Server's verdicts come from its own schema, parsed as the
  Server parses it. Cloud was not observed.
- The legacy endpoint queues a write unless the body sets `async: false`, which the Provider does not send. That is
  unchanged here.
- The live runs' two projects and 36 memories remain in the lab's store; the lab's `dsh-lab` project kept its six
  memories.
