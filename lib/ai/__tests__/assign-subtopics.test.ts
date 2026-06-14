import { describe, it, expect } from 'vitest'
import { embedTexts } from '../embeddings'
import { assignChunksToSubtopics, SubtopicSeed, ChunkVec } from '../assign-subtopics'

describe('assignChunksToSubtopics', () => {
  it('sorts chunks into the right subtopic by meaning', async () => {
    const heart = [
      'the mitral valve separates the left atrium and left ventricle',
      'aortic valve stenosis affects blood flow from the ventricle',
      'tricuspid valve regurgitation in the right atrium and ventricle',
    ]
    const lung = [
      'alveoli enable oxygen and carbon dioxide gas exchange in the lung',
      'lung compliance and airway resistance affect breathing mechanics',
      'pulmonary ventilation moves air into the alveoli during respiration',
    ]
    const subtopicDescs = [
      'Heart valves: mitral aortic tricuspid valve atrium ventricle blood flow',
      'Lung mechanics: alveoli oxygen gas exchange breathing ventilation respiration',
    ]

    const [hVecs, lVecs, sVecs] = await Promise.all([
      embedTexts(heart),
      embedTexts(lung),
      embedTexts(subtopicDescs),
    ])

    const chunks: ChunkVec[] = [
      ...heart.map((_, i) => ({ id: `h${i}`, embedding: hVecs[i] })),
      ...lung.map((_, i) => ({ id: `l${i}`, embedding: lVecs[i] })),
    ]
    const subtopics: SubtopicSeed[] = [
      { topic: 'Cardiovascular', name: 'Heart Valves', embedding: sVecs[0] },
      { topic: 'Respiratory', name: 'Lung Mechanics', embedding: sVecs[1] },
    ]

    const result = assignChunksToSubtopics(chunks, subtopics)
    const by = (id: string) => result.find((r) => r.chunkId === id)!

    for (const i of [0, 1, 2]) expect(by(`h${i}`).subtopic).toBe('Heart Valves')
    for (const i of [0, 1, 2]) expect(by(`l${i}`).subtopic).toBe('Lung Mechanics')
  })

  it('marks everything unassigned when there are no subtopics', () => {
    const result = assignChunksToSubtopics(
      [{ id: 'a', embedding: [1, 0, 0] }],
      []
    )
    expect(result[0].subtopic).toBeNull()
    expect(result[0].confident).toBe(false)
  })
})
