import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createMemorySpaceProviderFixture } from 'dsh-mnemon-source-memory-spaces/testing'
import { HolographicProvider, descriptor } from '../src/index.ts'

const temporaryDirectories: string[] = []
afterEach(() => { for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

describe('standalone holographic data plane', () => {
  it('preserves exact Jaccard scores for unequal token sets and Unicode', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'dsh-mnemon-holographic-score-'))
    temporaryDirectories.push(dataDir)
    const { authority, body } = createMemorySpaceProviderFixture(descriptor, { defaultTrust: 1, minTrust: 0 }, { dataDir })
    const provider = new HolographicProvider(authority)
    await provider.remember(body, { content: 'alpha gamma delta' })
    await provider.remember(body, { content: '存储 查询' })
    expect((await provider.search(body, { query: 'alpha beta' })).results.map(row => row.score)).toEqual([1 / 4])
    expect((await provider.search(body, { query: 'alpha beta gamma delta epsilon' })).results.map(row => row.score)).toEqual([3 / 5])
    expect((await provider.search(body, { query: '存储 beta' })).results.map(row => row.score)).toEqual([3 / 7])
    expect((await provider.search(body, { query: 'unknown terms' })).results).toEqual([])
    expect((await provider.search(body, { query: '' })).results.map(row => row.score)).toEqual([0.9, 0.9])
  })

  it('stores Holographic facts locally with trust, entities, graph projection, related recall, and hard forget', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'dsh-mnemon-holographic-'))
    temporaryDirectories.push(dataDir)
    const dataPath = join(dataDir, 'facts', 'memory.json')

    const { authority: registry, body } = createMemorySpaceProviderFixture(descriptor, { dataPath, defaultTrust: 0.7, minTrust: 0.3 }, { dataDir, instanceId: 'work-account' })
    const provider = new HolographicProvider(registry)

    const first = await provider.remember(body, {
      content: 'TypeScript service uses SQLite for durable state.',
      category: 'decision',
      tags: ['architecture'],
      entities: ['TypeScript', 'SQLite'],
    }) as { id: string }
    const second = await provider.remember(body, {
      content: 'SQLite backups run daily before deployment.',
      category: 'fact',
      entities: ['SQLite'],
    }) as { id: string }

    await expect(provider.remember(body, { content: 'TypeScript service uses SQLite for durable state.' })).resolves.toMatchObject({ action: 'skipped', id: first.id })
    await expect(provider.search(body, { query: 'TypeScript storage', limit: 5 })).resolves.toEqual({
      results: [expect.objectContaining({ id: first.id, category: 'decision', entities: ['TypeScript', 'SQLite'] })],
    })
    await expect(provider.related(body, first.id, 2)).resolves.toEqual([expect.objectContaining({ id: second.id })])
    await expect(provider.graph(body)).resolves.toMatchObject({
      nodes: expect.arrayContaining([expect.objectContaining({ id: 'entity:SQLite', kind: 'entity' })]),
      edges: expect.arrayContaining([expect.objectContaining({ sourceId: first.id, targetId: 'entity:SQLite', type: 'entity' })]),
    })
    await expect(provider.status(body)).resolves.toMatchObject({ healthy: true, stats: { totalInsights: 2, edgeCount: 3 } })
    expect(statSync(dataPath).mode & 0o777).toBe(0o600)
    await expect(provider.forget(body, first.id)).resolves.toMatchObject({ action: 'deleted' })
    await expect(provider.list(body, {})).resolves.toHaveLength(1)
  })

  describe('trust from importance (#447)', () => {
    function store(connection: Record<string, number>) {
      const dataDir = mkdtempSync(join(tmpdir(), 'dsh-mnemon-holographic-trust-'))
      temporaryDirectories.push(dataDir)
      const dataPath = join(dataDir, 'facts.json')
      const { authority, body } = createMemorySpaceProviderFixture(descriptor, { dataPath, ...connection }, { dataDir })
      const facts = () => (JSON.parse(readFileSync(dataPath, 'utf8')) as { facts: Array<{ content: string; trustScore: number; importance?: number }> }).facts
      return { provider: new HolographicProvider(authority), body, dataPath, facts }
    }

    it('starts importance 3 at the default trust and moves 0.1 per step, within 0..1', async () => {
      const { provider, body, facts } = store({ defaultTrust: 0.5, minTrust: 0 })
      for (const importance of [1, 2, 3, 4, 5]) await provider.remember(body, { content: `Fact of importance ${importance}`, importance })
      expect(facts().map(fact => [fact.importance, fact.trustScore])).toEqual([[1, 0.3], [2, 0.4], [3, 0.5], [4, 0.6], [5, 0.7]])
      const edges = store({ defaultTrust: 0.95, minTrust: 0 })
      await edges.provider.remember(edges.body, { content: 'Highest', importance: 5 })
      await edges.provider.remember(edges.body, { content: 'Out of range', importance: 9 })
      expect(edges.facts().map(fact => [fact.importance, fact.trustScore])).toEqual([[5, 1], [5, 1]])
    })

    it('recalls only the higher importance when the minimum trust lies between them', async () => {
      const { provider, body } = store({ defaultTrust: 0.5, minTrust: 0.5 })
      await provider.remember(body, { content: 'Release notes are drafted on Monday', importance: 1 })
      await provider.remember(body, { content: 'Release approvals need a completed canary', importance: 5 })
      expect((await provider.search(body, { query: 'release' })).results.map(row => [row.content, row.importance]))
        .toEqual([['Release approvals need a completed canary', 5]])
      expect((await provider.list(body, {})).map(row => row.importance)).toEqual([5])
    })

    it('starts a fact without importance at the default trust', async () => {
      const { provider, body, facts } = store({ defaultTrust: 0.7, minTrust: 0.3 })
      await provider.remember(body, { content: 'No importance given' })
      expect(facts()).toEqual([expect.objectContaining({ trustScore: 0.7 })])
      expect(facts()[0]).not.toHaveProperty('importance')
    })

    it('scores by relevance, not by trust, so a low-importance match keeps its recall tier', async () => {
      const { provider, body } = store({ defaultTrust: 0.5, minTrust: 0.3 })
      await provider.remember(body, { content: 'The staging cluster runs Kubernetes 1.31', importance: 1 })
      expect((await provider.search(body, { query: 'staging cluster' })).results.map(row => row.score)).toEqual([0.9])
    })

    it('keeps facts written before the fix as they are, without an importance', async () => {
      const { provider, body, dataPath } = store({ defaultTrust: 0.5, minTrust: 0.3 })
      const legacy = { id: 'holo-legacy', content: 'Legacy fact about SQLite backups', category: 'fact', tags: [], entities: ['SQLite'],
        trustScore: 1, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }
      writeFileSync(dataPath, JSON.stringify({ version: 1, facts: [legacy] }))
      const [row] = await provider.list(body, {})
      expect(row).toMatchObject({ id: 'holo-legacy', content: legacy.content })
      expect(row).not.toHaveProperty('importance')
      await provider.remember(body, { content: 'New fact', importance: 4 })
      expect((JSON.parse(readFileSync(dataPath, 'utf8')) as { facts: unknown[] }).facts[0]).toEqual(legacy)
    })
  })
})
