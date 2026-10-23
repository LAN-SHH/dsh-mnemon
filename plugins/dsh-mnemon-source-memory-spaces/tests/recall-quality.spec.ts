import { describe, expect, it } from 'vitest'
import { resolveMemorySpacesConfig } from "../src/config.ts"
import { NORMALIZED_RELEVANCE_SCORE } from '../src/providers/adapter.ts'
import {
  BALANCED_RECALL_QUALITY_POLICY,
  EXHAUSTIVE_RECALL_QUALITY_POLICY,
  RecallQualityPolicyRegistry,
  STRICT_RECALL_QUALITY_POLICY,
  applyRecallQualityPolicy,
  prepareRecallQualityPolicy,
  type RecallQualityCandidate,
  type RecallQualityPolicy,
  type RecallQualityPolicyContext,
} from '../src/recall-quality/index.ts'

function context(policy = 'strict-v1', requestedLimit = 10): RecallQualityPolicyContext {
  return { requestedLimit, config: resolveMemorySpacesConfig({ recallQuality: { policy } }).recallQuality }
}

function candidate(id: string, score?: number, normalized = true, providerId: RecallQualityCandidate['providerId'] = 'mnemon-native', providerRank = 1): RecallQualityCandidate {
  return {
    insight: { id, content: id, ...(score === undefined ? {} : { score }) },
    memoryBodyId: normalized ? 'project' : providerId,
    providerId,
    providerRank,
    bodyOrder: 0,
    ...(normalized ? { scoreSemantics: NORMALIZED_RELEVANCE_SCORE } : {}),
  }
}

/** strict-v1 as it was before uncalibrated Providers kept their rank (#454), for the calibrated comparison. */
function strictBefore(candidates: readonly RecallQualityCandidate[], policyContext: RecallQualityPolicyContext) {
  const { lowScoreThreshold, highScoreThreshold, maxMediumResults, maxUnknownResults } = policyContext.config
  const evaluated = candidates.map(entry => {
    const score = entry.insight.score
    const decision = score === undefined ? { action: 'keep', tier: 'unknown' }
      : !Number.isFinite(score) ? { action: 'drop', tier: 'unknown' }
      : entry.scoreSemantics?.kind !== 'normalized-relevance' ? { action: 'keep', tier: 'unknown' }
      : score <= 0 ? { action: 'drop', tier: 'low', normalizedScore: 0 }
      : score > 1 ? { action: 'keep', tier: 'unknown' }
      : score < lowScoreThreshold ? { action: 'drop', tier: 'low', normalizedScore: score }
      : score < highScoreThreshold ? { action: 'keep', tier: 'medium', normalizedScore: score }
      : { action: 'keep', tier: 'high', normalizedScore: score }
    return { id: entry.insight.id, decision }
  })
  const kept = evaluated.filter(entry => entry.decision.action === 'keep')
  const selected = [
    ...kept.filter(entry => entry.decision.tier === 'high'),
    ...kept.filter(entry => entry.decision.tier === 'medium').slice(0, maxMediumResults),
    ...kept.filter(entry => entry.decision.tier === 'unknown').slice(0, maxUnknownResults),
  ].slice(0, policyContext.requestedLimit)
  return { evaluated, selected: selected.map(entry => entry.id) }
}

describe('recall quality policies', () => {
  it('strict-v1 enforces score boundaries while retaining unscored, out-of-range and uncalibrated ranks', () => {
    const policyContext = context()
    const prepared = prepareRecallQualityPolicy(STRICT_RECALL_QUALITY_POLICY, policyContext)
    const result = applyRecallQualityPolicy(prepared, [
      candidate('high', 0.6),
      candidate('medium-upper', 0.599),
      candidate('medium-lower', 0.25),
      candidate('low', 0.249),
      candidate('zero', 0),
      candidate('unscored'),
      candidate('unscaled', 99),
      candidate('provider-unknown', 0.1, false),
    ], policyContext)

    // The uncalibrated row keeps its place (last here) instead of competing for the unknown budget (#454).
    expect(result.selected.map(entry => entry.candidate.insight.id)).toEqual([
      'high', 'medium-upper', 'medium-lower', 'unscored', 'unscaled', 'provider-unknown',
    ])
    expect(result.evaluated.map(entry => [entry.candidate.insight.id, entry.decision])).toEqual(expect.arrayContaining([
      ['high', expect.objectContaining({ action: 'keep', tier: 'high', normalizedScore: 0.6 })],
      ['medium-lower', expect.objectContaining({ action: 'keep', tier: 'medium', normalizedScore: 0.25 })],
      ['low', expect.objectContaining({ action: 'drop', reason: 'low-score' })],
      ['zero', expect.objectContaining({ action: 'drop', reason: 'non-positive-score' })],
      ['unscaled', expect.objectContaining({ action: 'keep', tier: 'unknown', reason: 'out-of-range-score' })],
      ['provider-unknown', { action: 'keep', tier: 'ranked', reason: 'uncalibrated-score' }],
    ]))
    expect(prepared.candidateLimit).toBe(30)
  })

  it('strict-v1 budgets medium and unknown rows instead of filling the requested limit', () => {
    const policyContext = context('strict-v1', 10)
    const result = applyRecallQualityPolicy(
      prepareRecallQualityPolicy(STRICT_RECALL_QUALITY_POLICY, policyContext),
      [
        candidate('high-1', 0.9), candidate('high-2', 0.7),
        candidate('medium-1', 0.59), candidate('medium-2', 0.5), candidate('medium-3', 0.4),
        candidate('medium-4', 0.3), candidate('medium-5', 0.29), candidate('medium-6', 0.28),
        candidate('unknown-1'), candidate('unknown-2'), candidate('unknown-3'),
      ],
      policyContext,
    )

    expect(result.selected.map(entry => entry.candidate.insight.id)).toEqual([
      'high-1', 'high-2', 'medium-1', 'medium-2', 'medium-3', 'medium-4', 'unknown-1', 'unknown-2',
    ])
  })

  it('balanced-v1 places low-score rows after primary evidence while exhaustive-v1 preserves zero scores', () => {
    const balancedContext = context('balanced-v1', 2)
    const balanced = applyRecallQualityPolicy(
      prepareRecallQualityPolicy(BALANCED_RECALL_QUALITY_POLICY, balancedContext),
      [candidate('low', 0.1), candidate('high', 0.8), candidate('medium', 0.4)],
      balancedContext,
    )
    expect(balanced.selected.map(entry => entry.candidate.insight.id)).toEqual(['high', 'medium'])

    const exhaustiveContext = context('exhaustive-v1', 2)
    const exhaustive = applyRecallQualityPolicy(
      prepareRecallQualityPolicy(EXHAUSTIVE_RECALL_QUALITY_POLICY, exhaustiveContext),
      [candidate('zero', 0), candidate('low', 0.1)],
      exhaustiveContext,
    )
    expect(exhaustive.selected.map(entry => entry.candidate.insight.id)).toEqual(['zero', 'low'])
  })

  it('keeps an uncalibrated Provider\'s best row ahead of another Provider\'s weak rows (#454)', () => {
    const policyContext = context('strict-v1', 5)
    // Federated order: each Provider's rank 1, then rank 2, and so on. Neither Provider calibrates its
    // scores: Hindsight's final score adds boosts and passes 1, OpenViking reports raw cosine similarity.
    const result = applyRecallQualityPolicy(prepareRecallQualityPolicy(STRICT_RECALL_QUALITY_POLICY, policyContext), [
      candidate('hindsight-answer', 1.0379764538482916, false, 'hindsight', 1),
      candidate('openviking-weak-1', 0.7107269167900085, false, 'openviking', 1),
      candidate('openviking-weak-2', 0.7017678022384644, false, 'openviking', 2),
      candidate('openviking-weak-3', 0.685615599155426, false, 'openviking', 3),
      candidate('openviking-weak-4', 0.6702136397361755, false, 'openviking', 4),
    ], policyContext)

    expect(result.selected.map(entry => entry.candidate.insight.id)).toEqual([
      'hindsight-answer', 'openviking-weak-1', 'openviking-weak-2', 'openviking-weak-3', 'openviking-weak-4',
    ])
    expect(new Set(result.evaluated.map(entry => `${entry.decision.tier}/${entry.decision.reason}`))).toEqual(new Set(['ranked/uncalibrated-score']))
    expect(result.evaluated.every(entry => entry.decision.normalizedScore === undefined)).toBe(true)
  })

  it('puts ranked rows at their federated place among banded rows, inside the requested limit', () => {
    const policyContext = context('strict-v1', 5)
    const result = applyRecallQualityPolicy(prepareRecallQualityPolicy(STRICT_RECALL_QUALITY_POLICY, policyContext), [
      candidate('native-medium', 0.4, true, 'mnemon-native', 1),
      candidate('openviking-1', 0.82, false, 'openviking', 1),
      candidate('native-high', 0.9, true, 'mnemon-native', 2),
      candidate('openviking-2', 0.8, false, 'openviking', 2),
      candidate('native-low', 0.1, true, 'mnemon-native', 3),
      candidate('openviking-3', 0.79, false, 'openviking', 3),
      candidate('openviking-4', 0.78, false, 'openviking', 4),
    ], policyContext)

    // Banded rows keep today's order among themselves (high before medium, low dropped).
    expect(result.selected.map(entry => entry.candidate.insight.id)).toEqual([
      'openviking-1', 'native-high', 'native-medium', 'openviking-2', 'openviking-3',
    ])
  })

  it('keeps an uncalibrated row without a score ranked, and still drops a non-finite score', () => {
    const policyContext = context()
    const result = applyRecallQualityPolicy(prepareRecallQualityPolicy(STRICT_RECALL_QUALITY_POLICY, policyContext), [
      candidate('honcho-unscored', undefined, false, 'honcho', 1),
      candidate('honcho-nan', Number.NaN, false, 'honcho', 2),
    ], policyContext)
    expect(result.evaluated.map(entry => [entry.candidate.insight.id, entry.decision])).toEqual([
      ['honcho-unscored', { action: 'keep', tier: 'ranked', reason: 'unscored' }],
      ['honcho-nan', { action: 'drop', tier: 'unknown', reason: 'invalid-score' }],
    ])
    expect(result.selected.map(entry => entry.candidate.insight.id)).toEqual(['honcho-unscored'])
  })

  it('balanced-v1 and exhaustive-v1 keep ranked rows in their federated place', () => {
    const rows = [candidate('low', 0.1), candidate('ranked', 0.3, false, 'openviking', 1), candidate('high', 0.8)]
    const balancedContext = context('balanced-v1', 3)
    expect(applyRecallQualityPolicy(prepareRecallQualityPolicy(BALANCED_RECALL_QUALITY_POLICY, balancedContext), rows, balancedContext)
      .selected.map(entry => entry.candidate.insight.id)).toEqual(['ranked', 'high', 'low'])
    const exhaustiveContext = context('exhaustive-v1', 3)
    expect(applyRecallQualityPolicy(prepareRecallQualityPolicy(EXHAUSTIVE_RECALL_QUALITY_POLICY, exhaustiveContext), rows, exhaustiveContext)
      .selected.map(entry => entry.candidate.insight.id)).toEqual(['low', 'ranked', 'high'])
  })

  it('leaves calibrated Providers\' decisions and selection exactly as before', () => {
    // A deterministic spread of scores, including edges, non-finite values and out-of-range scores.
    let seed = 454
    const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
    const pool = [undefined, Number.NaN, Number.POSITIVE_INFINITY, -0.2, 0, 0.1, 0.249, 0.25, 0.4, 0.599, 0.6, 0.75, 1, 1.0379, 2]
    for (let round = 0; round < 200; round += 1) {
      const limit = 1 + Math.floor(next() * 10)
      const policyContext = context('strict-v1', limit)
      const rows = Array.from({ length: 1 + Math.floor(next() * 12) }, (_, index) => candidate(`r${index}`, pool[Math.floor(next() * pool.length)]))
      const before = strictBefore(rows, policyContext)
      const after = applyRecallQualityPolicy(prepareRecallQualityPolicy(STRICT_RECALL_QUALITY_POLICY, policyContext), rows, policyContext)
      expect(after.selected.map(entry => entry.candidate.insight.id)).toEqual(before.selected)
      expect(after.evaluated.map(entry => {
        const { reason: _reason, ...decision } = entry.decision
        return { id: entry.candidate.insight.id, decision }
      })).toEqual(before.evaluated)
    }
  })

  it('registers replaceable policies and rejects duplicate ids', () => {
    const registry = new RecallQualityPolicyRegistry([])
    const custom: RecallQualityPolicy = { ...STRICT_RECALL_QUALITY_POLICY, id: 'custom-v1' }
    const dispose = registry.register(custom)
    expect(registry.resolve('custom-v1')).toBe(custom)
    expect(() => registry.register(custom)).toThrow('already registered')
    dispose()
    expect(() => registry.resolve('custom-v1')).toThrow('unknown recall quality policy')
  })

  it('falls back to strict-v1 when a custom policy returns an unsafe limit or selection', () => {
    const policyContext = context('broken-v1', 2)
    const badLimit: RecallQualityPolicy = { ...STRICT_RECALL_QUALITY_POLICY, id: 'broken-v1', candidateLimit: () => 0 }
    const prepared = prepareRecallQualityPolicy(badLimit, policyContext)
    expect(prepared).toMatchObject({ policy: STRICT_RECALL_QUALITY_POLICY, candidateLimit: 6, fallbackFrom: 'broken-v1' })

    const unsafeSelection: RecallQualityPolicy = {
      ...STRICT_RECALL_QUALITY_POLICY,
      id: 'unsafe-v1',
      select: candidates => [candidates.find(entry => entry.decision.action === 'drop')!],
    }
    const unsafeContext = context('unsafe-v1', 2)
    const result = applyRecallQualityPolicy(
      prepareRecallQualityPolicy(unsafeSelection, unsafeContext),
      [candidate('high', 0.8), candidate('low', 0.1)],
      unsafeContext,
    )
    expect(result).toMatchObject({ policyId: 'strict-v1', fallbackFrom: 'unsafe-v1' })
    expect(result.selected.map(entry => entry.candidate.insight.id)).toEqual(['high'])
  })
})
