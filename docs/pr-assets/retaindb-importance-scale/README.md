# RetainDB importance on its 0-1 scale

[简体中文](./README.zh-CN.md) | [Verification record](./verification.json)

The Memory Spaces Source gives every memory an integer importance from 1 to 5, and 3 when the writer gives none.
The RetainDB Provider sent that number to RetainDB as is, but RetainDB takes an importance from 0 to 1, with 0.7 as
its default.

Baseline: main `a7e3bc54`. The runs took place on 2026-10-23 (Asia/Shanghai) on macOS arm64 with Node 24.19.0 and pnpm
10.13.1. All memories are synthetic.

**The hosted RetainDB service was not available**: there is no account for it, so it was not tested. RetainDB Local
0.2.2, RetainDB's open-source server, was run from the provider lab on loopback. The evidence is:

- RetainDB's contract, from the two sources below;
- request-level checks: unit tests of the body the Provider sends, and a probe that writes through the real Memory
  Spaces Source to a loopback recorder;
- a live run against RetainDB Local through the real Source, on main and with the fix.

## Cause

- The Source sends every Provider an integer importance from 1 to 5, and 3 when the writer gives none:
  `prepareRemember` in `plugins/dsh-mnemon-source-memory-spaces/src/service.ts` calls
  `integer(request.importance, 3, 1, 5)` from `src/sdk/input.ts` for both `remember` and `rememberMany`.
- The Provider sent `importance: request.importance ?? 0.7`. An importance always arrives through the Source, so the
  0.7 fallback never applied, and RetainDB received 1 to 5.
- RetainDB takes 0 to 1, with 0.7 as its default:
  - Hermes Agent's RetainDB provider, written for the hosted API at `https://api.retaindb.com`, describes the remember
    tool's importance as "Importance 0-1 (default: 0.7)". It sends that float in the `POST /v1/memory` body, and in
    the legacy `POST /v1/memories` body on fallback
    ([`plugins/memory/retaindb/__init__.py`](https://github.com/NousResearch/hermes-agent/blob/419e6627aaeda9c87e0b17bcc013484a2bfdb194/plugins/memory/retaindb/__init__.py#L78)
    at `419e6627`, lines 78, 148-152 and 481).
  - RetainDB Local 0.2.2, RetainDB's own open-source server, stores a new memory's importance as
    `clamp((importance ?? 0.62) + quality * 0.28 + typeWeight * 0.12, 0.1, 0.99)` and adds it to every recall score
    ([`packages/local/src/cli.ts`](https://github.com/RetainDB/RetainDB/blob/2ad2cc4d6d58145eca1a6cbbce66dfc5b5380f38/packages/local/src/cli.ts#L728)
    at `2ad2cc4d`, lines 728 and 904). Any importance of 1 or more is stored at 0.99. On main, RetainDB Local
    therefore stored every memory at its highest importance, and importance no longer told memories apart in recall.
    The live run below shows both.
- How the hosted service treats a value above 1, whether it clamps or refuses it, was not observed.

## Fix

- `remember` sends the importance on RetainDB's scale. Importance 3, the Source's default, maps to RetainDB's default
  0.7. Each step above or below moves it by 0.1, within 0 to 1, rounded to two decimals so that 1 is sent as 0.5 and
  not 0.49999999999999994.
- A request without an importance is sent as 0.7, as before. It reaches the Provider only when the Provider is called
  without the Source.
- The legacy `POST /v1/memories` fallback sends the same value, since it is the same body without `write_mode`.
- Nothing maps back. The Provider reads search and list results without an importance, only their id, content,
  score, type and creation time, so recall and browse show no RetainDB importance, before or after the fix.
- Memories already in RetainDB are not rewritten. On RetainDB Local they keep the 0.99 they were stored with, which
  still counts in their recall scores. The importance they were written with was lost to the clamp, so rewriting them
  would guess at it.

| Importance at the Provider | main sends | Fix sends |
|---|---|---|
| 1 | 1 | 0.5 |
| 2 | 2 | 0.6 |
| 3, also what the Source sends when the writer gives none | 3 | 0.7 |
| 4 | 4 | 0.8 |
| 5 | 5 | 0.9 |
| none (the Provider called without the Source) | 0.7 | 0.7 |

## Through the Memory Spaces Source

[`importance.probe.mjs`](./importance.probe.mjs) mounts the real Memory Spaces Source with the RetainDB Provider and
enables RetainDB against a loopback recorder that answers RetainDB's project and memory routes. It then writes three
memories through `remember` and records the importance in each `POST /v1/memory` body.

| Memory | Importance written | main sends | Fix sends |
|---|---|---|---|
| Release notes are drafted on Monday | 1 | 1 | 0.5 |
| Release approvals need a completed canary | 5 | 5 | 0.9 |
| Release branches are cut from main | none (the Source sends 3) | 3 | 0.7 |

## Against RetainDB Local

[`live.probe.mjs`](./live.probe.mjs) ran against RetainDB Local 0.2.2 from the provider lab: the `retaindb` service in
[`provider-lab/`](../../../provider-lab/README.md), with hash embeddings, on `http://127.0.0.1:18990`. The container
had been stopped. It was started for these runs, stopped again afterwards, and its volume was kept.

Each run used a new project of its own and user `rv462`: `rv462-main` with main's driver, `rv462-fix` with the fix.
Each run then:

1. wrote four memories through the real Memory Spaces Source. They share their wording and length, so RetainDB Local
   gives all four the same type (`workflow`) and quality (0.275), and only the importance differs;
2. read back what RetainDB Local stored;
3. searched `release step check before tagging the version` with the request the Provider sends;
4. searched the same words through the Source.

| Importance written | main: stored importance | Fix: stored importance |
|---|---|---|
| 1 | 0.99 | 0.661 |
| 3 | 0.99 | 0.861 |
| 5 | 0.99 | 0.99 |
| none (the Source sends 3) | 0.99 | 0.861 |

RetainDB Local added 0.161 to each importance it received (quality 0.275 × 0.28, plus the `workflow` weight
0.7 × 0.12), then capped it at 0.99, so the fix's 0.9 also reached the cap. Its `strength` follows the importance too:
0.855 for importance 1 and 1 for the others on main, and 0.605, 0.705, 0.805 and 0.705 with the fix.

| RetainDB Local's recall | main: importance written (score) | Fix: importance written (score) |
|---|---|---|
| 1st | 3 (11.1374) | 5 (11.0862) |
| 2nd | 5 (11.1118) | 3 (10.9820) |
| 3rd | 1 (11.0614) | none (10.8307) |
| 4th | none (10.9846) | 1 (10.8092) |

On main, every memory carried 0.99, so small differences in relevance set the order, and importance 1 ranked above a
memory of importance 3. With the fix, the stored importance sets it: 5 first, 3 and none next, 1 last.

Through the Source, the default `strict-v1` recall keeps at most two results whose score lies outside 0 to 1, as
RetainDB Local's scores do. It returned 3 then 5 on main, and 5 then 3 with the fix.

## Automated checks

```text
pnpm --filter dsh-mnemon-provider-retaindb exec vitest run     # 15 passed; on main, 7 of the 8 new tests fail
pnpm --filter dsh-mnemon-provider-retaindb run typecheck
pnpm --filter dsh-mnemon-provider-retaindb run build
pnpm --filter dsh-mnemon-source-memory-spaces exec vitest run  # 296 passed, 2 skipped
node docs/pr-assets/retaindb-importance-scale/importance.probe.mjs <out.json>
node docs/pr-assets/retaindb-importance-scale/live.probe.mjs http://127.0.0.1:18990 <new project> <out.json>
node scripts/verify-docs.mjs
```

The main runs used main's `driver.ts`: the new tests ran against it, and both probes ran against the package built
from it. The new unit tests check:

- the whole body sent for importance 1 to 5;
- the 0.7 sent for a request without an importance;
- the clamp to 0 to 1 for a value outside 1 to 5;
- the same importance on the legacy endpoint.

On main, the test without an importance passes, because main also sent 0.7 then. The other seven fail.

## Limits

- The hosted service was not tested, so what it stores for 0.5 to 0.9, and what it did with 1 to 5, was not observed.
- The live run used RetainDB Local with the hash embeddings the provider lab configures. Its two projects and eight
  memories remain in the lab's store; the lab's `dsh-lab` project kept its six memories.
- No WebUI recording was made. The interface is unchanged, and RetainDB memories show no importance before or after.
