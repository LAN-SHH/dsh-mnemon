# Recall with Providers that score on different scales — issue #454

[简体中文](./README.zh-CN.md) | [Issue #454](https://github.com/omdsh-dev/dsh-mnemon/issues/454) | [Verification record](./verification.json)

Issue #454 reports that recall across Hindsight and OpenViking ranked the right answer last or left it out. Hindsight scored the answer 1.04, and the Source treated that as "unknown". Weak OpenViking rows at about 0.7 took the medium places.

Every Provider in the Starter but Honcho declared its scores normalized, but only Mnemon Native and Holographic compute scores Mnemon controls. The others pass their engines' own scales through. One fixed pair of thresholds, 0.25 and 0.6, cannot band all of them.

Baseline: main `a7e3bc54`. The runs took place on 2026-10-23 (Asia/Shanghai) with:

- macOS arm64, Node 24.19.0 and pnpm 10.13.1;
- Hindsight 0.10.1 from `provider-lab`, with its local embeddings and reranker and the seeded `dsh-lab` bank;
- OpenViking v0.4.21 with `text-embedding-ada-002`, holding four unrelated synthetic notes in a separate account.

Both ran on loopback. The Source ran through `MemoryCompositionRunner` with the real Hindsight and OpenViking Providers, searching in smart mode with a limit of 4.

## Cause

- **Bands were applied to uncalibrated scales.**
  - Hindsight's `scores.final` adds reranker and recency boosts. In one bank it was 1.09 for the right answer and 0.00002 for an unrelated query.
  - OpenViking passes on raw cosine similarity. With ada-002, unrelated notes scored 0.66 to 0.74, which `strict-v1` bands as high relevance.
- **Out-of-scale answers were demoted.** A score above 1 became `unknown`, after every high and medium row and inside a budget of two. The three-tier strategy then admitted one unknown row per attempt.
- **One reason covered two cases.** "The Provider does not calibrate" and "the score is out of range" shared the reason `unscaled-score`.

## Fix

- Only Mnemon Native and Holographic keep `normalized-relevance`. OpenViking, Hindsight, Mem0, Supermemory and RetainDB now declare `provider-native`, and ByteRover declares `none`, because it always reports 1. Honcho was already `provider-native`.
- **Rows from Providers without calibrated scores are `ranked`.**
  - No threshold applies to them.
  - They keep their Provider's order and take their place in the federated order, which already alternates Providers by rank, within the requested limit.
  - The three-tier strategy admits them like high-relevance rows, inside its result and content limits.
- **Calibrated rows are unchanged.** Banded rows keep today's order among themselves. A recall without ranked rows selects exactly what it did before.
- **Reasons are split.** `uncalibrated-score` and `out-of-range-score` replace the shared `unscaled-score`, which stays accepted from custom policies. Quality stats gain `outOfRange`, and `unscaled` counts uncalibrated rows.

## Results with the real Providers

A relevant query: "新建记忆空间时，由谁、按什么规则选择 Provider？" ("Who chooses the Provider for a new Memory Space, and by what rules?")

| | main | Fix |
|---|---|---|
| 1 | OpenViking, high 0.687: desk lamp bulb | **Hindsight, ranked 1.091: the LLM chooses among allowed Providers by rules and prompt** |
| 2 | OpenViking, high 0.681: printer driver | OpenViking, ranked 0.687: desk lamp bulb |
| 3 | OpenViking, high 0.674: backup job | Hindsight, ranked 1.085: the WebUI does not present every Provider as the same database |
| 4 | OpenViking, high 0.664: VPN profile | OpenViking, ranked 0.681: printer driver |
| Hindsight rows selected | 0 of 8 (6 counted as unscaled) | 2 of 8 |

On main, four unrelated notes fill the limit as high relevance, and both Hindsight answers are left out. With the fix, the right answer comes first.

An unrelated query: "Which espresso machine does the kitchen use?"

| | main | Fix |
|---|---|---|
| Rows | four unrelated OpenViking notes, high 0.67 to 0.74 | two Hindsight rows (final 0.00003 and 0.00002) and two OpenViking rows, all ranked |
| Hindsight | all 8 dropped as low score | 2 selected |

Neither run had a relevant answer to find, and both return four unrelated rows; only their mix changes. Hindsight's own scores do separate relevant from unrelated within one bank, but on a scale of its own. Ranked rows no longer use that signal. Calibrating each Provider's scale would be a separate change.

## Tests

- **Policy tests** (`plugins/dsh-mnemon-source-memory-spaces/tests/recall-quality.spec.ts`) cover:
  - the #454 rows, where the uncalibrated Hindsight answer leads;
  - ranked rows placed among banded ones;
  - unscored and non-finite uncalibrated rows;
  - ranked rows under `balanced-v1` and `exhaustive-v1`.
- **Calibrated equivalence.** A 200-round deterministic comparison with the previous algorithm: calibrated candidates keep identical actions, tiers, normalized scores and selection. Only the reason for a score above 1 becomes `out-of-range-score`.
- **Source test** (`plugins/dsh-mnemon-source-memory-spaces/tests/service.spec.ts`). The real Hindsight and OpenViking adapters run with stubbed HTTP and a limit of 4. The answer leads, and every row is ranked.
- **On main** the new tests fail (5 of 87 in the two specs); with the fix they pass.
- **Strategy test** (`plugins/dsh-mnemon-strategy-default-three-tier/tests/retrieval.spec.ts`). Ranked rows are admitted like high ones, up to the four results of a first attempt, while unknown rows stay at one per attempt. It passes on main too, because the strategy already admitted tiers it does not name like high; it pins the admission the fix relies on.

## Limits

- Mem0, Supermemory and RetainDB were not run here. They are marked uncalibrated because they pass their services' scores through, as OpenViking does.
- No WebUI recording was made. The Content and Direct search pages read the same Source results, and no page displays tiers.
