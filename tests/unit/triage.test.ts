import { describe, expect, it } from 'vitest'
import { classifyDeterministically } from '@/lib/triage/deterministic-classifier'

describe('positive-signal-only triage', () => {
  it('allows OTC medicine searches without emergency escalation', () => {
    expect(classifyDeterministically('paracetamol near me')?.risk_tier).toBe('ALLOW')
  })

  it('gates metformin and sitagliptin as prescription medicines without emergency escalation', () => {
    expect(classifyDeterministically('metformin 500mg')?.risk_tier).toBe('GATE')
    expect(classifyDeterministically('sitagliptin 100mg')?.risk_tier).toBe('GATE')
  })

  it('fires restricted and crisis paths', () => {
    expect(classifyDeterministically('where can I buy tramadol without prescription')?.risk_tier).toBe('BLOCK_SOURCING')
    expect(classifyDeterministically('I want to kill myself')?.risk_tier).toBe('CRISIS')
  })

  it('uses emergency only for explicit red-flag language', () => {
    expect(classifyDeterministically('I cannot breathe')?.risk_tier).toBe('REDIRECT')
    expect(classifyDeterministically('I feel unwell')).toBeNull()
  })
})
