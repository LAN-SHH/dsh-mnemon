/** Memory Spaces-owned recall quality policy. */
import type {
  EvaluatedRecallQualityCandidate,
  RecallQualityCandidate,
  RecallQualityDecision,
  RecallQualityPolicy,
  RecallQualityPolicyContext,
} from './contracts.ts'

function expandedLimit(context: RecallQualityPolicyContext): number {
  return Math.min(50, Math.max(context.requestedLimit, Math.ceil(context.requestedLimit * context.config.candidateMultiplier)))
}

function scoreDecision(
  candidate: RecallQualityCandidate,
  context: RecallQualityPolicyContext,
  lowScoreAction: RecallQualityDecision['action'],
  nonPositiveAction: RecallQualityDecision['action'],
): RecallQualityDecision {
  const score = candidate.insight.score
  // A Provider that does not calibrate its scores is trusted for its order only: no fixed
  // threshold applies to it, and its rows keep their place in the federated order (#454).
  if (candidate.scoreSemantics?.kind !== 'normalized-relevance') {
    if (score !== undefined && !Number.isFinite(score)) return { action: 'drop', tier: 'unknown', reason: 'invalid-score' }
    return { action: 'keep', tier: 'ranked', reason: score === undefined ? 'unscored' : 'uncalibrated-score' }
  }
  if (score === undefined) return { action: 'keep', tier: 'unknown', reason: 'unscored' }
  if (!Number.isFinite(score)) return { action: 'drop', tier: 'unknown', reason: 'invalid-score' }
  if (score <= 0) return { action: nonPositiveAction, tier: 'low', reason: 'non-positive-score', normalizedScore: 0 }
  // A Provider violating its declared 0..1 range is safer as an unknown-scale
  // ranked result than as a fabricated high-confidence result.
  if (score > 1) return { action: 'keep', tier: 'unknown', reason: 'out-of-range-score' }
  if (score < context.config.lowScoreThreshold) return { action: lowScoreAction, tier: 'low', reason: 'low-score', normalizedScore: score }
  if (score < context.config.highScoreThreshold) return { action: 'keep', tier: 'medium', reason: 'medium-score', normalizedScore: score }
  return { action: 'keep', tier: 'high', reason: 'high-score', normalizedScore: score }
}

function primarySelection(candidates: readonly EvaluatedRecallQualityCandidate[], context: RecallQualityPolicyContext): EvaluatedRecallQualityCandidate[] {
  return candidates.filter(candidate => candidate.decision.action === 'keep').slice(0, context.requestedLimit)
}

/**
 * Put ranked rows back at their federated place among the banded selection. Each list keeps its own
 * order; whichever head came first in the candidates goes next. Without ranked rows nothing changes.
 */
function withRanked(
  banded: EvaluatedRecallQualityCandidate[],
  candidates: readonly EvaluatedRecallQualityCandidate[],
): EvaluatedRecallQualityCandidate[] {
  const ranked = candidates.filter(candidate => candidate.decision.action === 'keep' && candidate.decision.tier === 'ranked')
  if (ranked.length === 0) return banded
  const place = new Map(candidates.map((candidate, index) => [candidate, index]))
  const merged: EvaluatedRecallQualityCandidate[] = []
  let bandedIndex = 0
  let rankedIndex = 0
  while (bandedIndex < banded.length || rankedIndex < ranked.length) {
    const nextBanded = banded[bandedIndex]
    const nextRanked = ranked[rankedIndex]
    if (nextRanked === undefined || (nextBanded !== undefined && place.get(nextBanded)! < place.get(nextRanked)!)) {
      merged.push(nextBanded!)
      bandedIndex += 1
    } else {
      merged.push(nextRanked)
      rankedIndex += 1
    }
  }
  return merged
}

export const STRICT_RECALL_QUALITY_POLICY: RecallQualityPolicy = {
  id: 'strict-v1',
  candidateLimit: expandedLimit,
  evaluate: (candidate, context) => scoreDecision(candidate, context, 'drop', 'drop'),
  select(candidates, context) {
    const kept = candidates.filter(candidate => candidate.decision.action === 'keep')
    return withRanked([
      ...kept.filter(candidate => candidate.decision.tier === 'high'),
      ...kept.filter(candidate => candidate.decision.tier === 'medium').slice(0, context.config.maxMediumResults),
      ...kept.filter(candidate => candidate.decision.tier === 'unknown').slice(0, context.config.maxUnknownResults),
    ], candidates).slice(0, context.requestedLimit)
  },
}

export const BALANCED_RECALL_QUALITY_POLICY: RecallQualityPolicy = {
  id: 'balanced-v1',
  candidateLimit: expandedLimit,
  evaluate: (candidate, context) => scoreDecision(candidate, context, 'keep', 'drop'),
  select(candidates, context) {
    const kept = candidates.filter(candidate => candidate.decision.action === 'keep')
    return [
      ...kept.filter(candidate => candidate.decision.tier !== 'low'),
      ...kept.filter(candidate => candidate.decision.tier === 'low'),
    ].slice(0, context.requestedLimit)
  },
}

export const EXHAUSTIVE_RECALL_QUALITY_POLICY: RecallQualityPolicy = {
  id: 'exhaustive-v1',
  candidateLimit: expandedLimit,
  evaluate: (candidate, context) => scoreDecision(candidate, context, 'keep', 'keep'),
  select: primarySelection,
}

export const BUILTIN_RECALL_QUALITY_POLICIES = [
  STRICT_RECALL_QUALITY_POLICY,
  BALANCED_RECALL_QUALITY_POLICY,
  EXHAUSTIVE_RECALL_QUALITY_POLICY,
] as const
