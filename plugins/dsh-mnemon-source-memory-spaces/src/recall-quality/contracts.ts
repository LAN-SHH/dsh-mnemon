/** Memory Spaces-owned recall quality policy. */
import type { Insight, MemoryProviderId, ResolvedRecallQualityConfig } from '../contracts.ts'
import type { ProviderScoreSemantics } from '../providers/adapter.ts'

export type RecallQualityDecisionReason =
  | 'high-score'
  | 'medium-score'
  | 'low-score'
  | 'non-positive-score'
  | 'invalid-score'
  /** A Provider that does not calibrate its scores: its own rank is the signal (#454). */
  | 'uncalibrated-score'
  /** A score outside the 0..1 a Provider declared, so no band is trusted. */
  | 'out-of-range-score'
  /** Kept for policies written before the two reasons above. */
  | 'unscaled-score'
  | 'unscored'

export interface RecallQualityCandidate {
  insight: Insight
  memoryBodyId: string
  providerId: MemoryProviderId
  providerRank: number
  bodyOrder: number
  scoreSemantics?: ProviderScoreSemantics
}

export interface RecallQualityDecision {
  action: 'keep' | 'drop'
  /** `ranked`: kept in its Provider's own order, with no band. */
  tier: 'high' | 'medium' | 'low' | 'unknown' | 'ranked'
  reason: RecallQualityDecisionReason
  normalizedScore?: number
}

export interface EvaluatedRecallQualityCandidate {
  candidate: RecallQualityCandidate
  decision: RecallQualityDecision
}

export interface RecallQualityPolicyContext {
  requestedLimit: number
  config: ResolvedRecallQualityConfig
}

/** Pure, bounded policy applied before recall rows are serialized to an Agent. */
export interface RecallQualityPolicy {
  readonly id: string
  candidateLimit(context: RecallQualityPolicyContext): number
  evaluate(candidate: RecallQualityCandidate, context: RecallQualityPolicyContext): RecallQualityDecision
  select(candidates: readonly EvaluatedRecallQualityCandidate[], context: RecallQualityPolicyContext): EvaluatedRecallQualityCandidate[]
}
