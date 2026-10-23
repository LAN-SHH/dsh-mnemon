# 不同 Provider 分数尺度不一致时的召回：issue #454

[English](./README.md) | [Issue #454](https://github.com/omdsh-dev/dsh-mnemon/issues/454) | [验证记录](./verification.json)

Issue #454 报告：跨 Hindsight 与 OpenViking 召回时，正确答案被排到最后，或者干脆被丢掉。Hindsight 给正确答案打了 1.04 分，Source 把它判为“未知”；OpenViking 约 0.7 分的弱相关结果反而占据了“中”档。

Starter 中除 Honcho 外，每个 Provider 都声明自己的分数已归一化。但只有 Mnemon Native 与 Holographic 的分数由 Mnemon 自己计算，其他 Provider 都是直接透传各自引擎的尺度。一组固定阈值（0.25 与 0.6）不可能同时适用于这么多尺度。

基线为 main `a7e3bc54`。本次验证于 2026-10-23（Asia/Shanghai）进行，环境如下：

- macOS arm64，Node 24.19.0，pnpm 10.13.1；
- Hindsight 0.10.1，来自 `provider-lab`，使用其本地 embedding 与 reranker，以及已播种数据的 `dsh-lab` bank；
- OpenViking v0.4.21，使用 `text-embedding-ada-002`，在单独账号中放入四条不相关的合成记录。

两个服务都只监听本机回环地址。Source 通过 `MemoryCompositionRunner` 运行，挂载真实的 Hindsight 与 OpenViking Provider，以 smart 模式检索，上限为 4。

## 原因

- **固定阈值被套在了未校准的尺度上。**
  - Hindsight 的 `scores.final` 叠加了 reranker 与时效加成：同一个 bank 中，正确答案约为 1.09，不相关查询约为 0.00002。
  - OpenViking 透传原始余弦相似度：用 ada-002 时，不相关的记录也有 0.66 至 0.74，`strict-v1` 会把它们判为高相关。
- **超出尺度的答案被降级。** 超过 1 的分数被判为 `unknown`，排在所有高、中档结果之后，且只有两条的名额；三层策略每次尝试又只接纳一条未知结果。
- **两种情况共用一个原因。** “Provider 不做校准”与“分数超出范围”都记为 `unscaled-score`，无法区分。

## 修复

- **只保留两个已校准的 Provider。** 只有 Mnemon Native 与 Holographic 保留 `normalized-relevance`。OpenViking、Hindsight、Mem0、Supermemory 与 RetainDB 改为声明 `provider-native`；ByteRover 始终报告 1，改为声明 `none`；Honcho 原本就是 `provider-native`。
- **其余 Provider 的结果标为 `ranked`。**
  - 不对它们应用任何阈值。
  - 它们保留 Provider 自己的顺序，在请求上限内按联合排序中的位置排列（联合排序本来就按名次轮流排列各 Provider）。
  - 三层策略像对待高相关结果一样接纳它们，但仍受其结果数与正文长度上限约束。
- **已校准的结果不受影响。** 分档结果之间保持原有顺序；召回中没有 `ranked` 结果时，选出的结果与以前完全相同。
- **原因拆分。** 用 `uncalibrated-score` 与 `out-of-range-score` 取代原来共用的 `unscaled-score`；自定义策略仍可返回 `unscaled-score`。质量统计新增 `outOfRange`，`unscaled` 改为统计未校准的结果。

## 真实 Provider 上的结果

相关查询：“新建记忆空间时，由谁、按什么规则选择 Provider？”

| | main | 修复后 |
|---|---|---|
| 1 | OpenViking，高 0.687：台灯灯泡 | **Hindsight，ranked 1.091：由 LLM 按规则与 Prompt 在允许的 Provider 中选择** |
| 2 | OpenViking，高 0.681：打印机驱动 | OpenViking，ranked 0.687：台灯灯泡 |
| 3 | OpenViking，高 0.674：备份任务 | Hindsight，ranked 1.085：WebUI 不把所有 Provider 伪装成相同数据库 |
| 4 | OpenViking，高 0.664：VPN 配置 | OpenViking，ranked 0.681：打印机驱动 |
| 被选中的 Hindsight 结果 | 8 条中 0 条（6 条记为 unscaled） | 8 条中 2 条 |

在 main 上，四条不相关的记录作为高相关结果占满了上限，Hindsight 的两条答案都被挤掉。修复后，正确答案排在第一位。

不相关查询：“Which espresso machine does the kitchen use?”（厨房用的是哪台咖啡机？）

| | main | 修复后 |
|---|---|---|
| 结果 | 四条不相关的 OpenViking 记录，高 0.67 至 0.74 | 两条 Hindsight（final 0.00003 与 0.00002）与两条 OpenViking，均为 ranked |
| Hindsight | 8 条全部作为低分丢弃 | 选中 2 条 |

这条查询本来就没有相关答案可找，两次运行都返回四条不相关的结果，只是来源的组合不同。Hindsight 自己的分数在同一个 bank 内确实能区分相关与不相关，但用的是它自己的尺度，ranked 结果不再使用这一信号。若要为每个 Provider 校准尺度，需要另做一次改动。

## 测试

- **策略测试**（`plugins/dsh-mnemon-source-memory-spaces/tests/recall-quality.spec.ts`），覆盖：
  - #454 中的那组结果：未校准的 Hindsight 答案排在最前；
  - `ranked` 结果在分档结果中的位置；
  - 未打分与非有限分数的未校准结果；
  - `balanced-v1` 与 `exhaustive-v1` 下的 `ranked` 结果。
- **已校准等价性。** 与旧算法做 200 轮确定性对比：已校准候选的动作、档位、归一化分数与选择结果完全一致，只有超过 1 的分数的原因改为 `out-of-range-score`。
- **Source 测试**（`plugins/dsh-mnemon-source-memory-spaces/tests/service.spec.ts`）。以真实的 Hindsight 与 OpenViking 适配器配合模拟的 HTTP 响应，上限为 4：正确答案排在最前，所有结果均为 ranked。
- **在 main 上** 这些新测试失败（两个测试文件 87 项中失败 5 项），修复后全部通过。
- **三层策略测试**（`plugins/dsh-mnemon-strategy-default-three-tier/tests/retrieval.spec.ts`）。`ranked` 结果像高相关结果一样被接纳，最多占满首次尝试的四条，未知结果仍然每次尝试只接纳一条。这项测试在 main 上同样通过，因为策略本来就把它不认识的档位当作高相关接纳；它固定的是本次修复所依赖的接纳方式。

## 限制

- 本次没有实际运行 Mem0、Supermemory 与 RetainDB。把它们标为未校准，是因为它们和 OpenViking 一样直接透传各自服务的分数。
- 没有录制 WebUI。内容页与直接检索页读取的是同一份 Source 结果，没有页面展示档位。
