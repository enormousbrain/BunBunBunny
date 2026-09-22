import { describe, expect, it } from 'vitest';
import {
  composeCompanionPrompt,
  filterAllowedMemory,
  filterAllowedSignals,
  type CompanionProfile,
} from './companion';

const profile: CompanionProfile = {
  name: 'Bunzo',
  style: 'bright, silly, and brave',
  traits: ['cheers first', 'uses short pep-talks'],
  boundaries: ['no body comments', 'no outside-life guesses'],
  memory: [
    { source: 'gameplay', statement: 'The player likes launching blocks into towers.' },
    { source: 'personalityAdjustment', statement: 'The player prefers gentler teasing.' },
    { source: 'external', statement: 'The player was at a real-world soccer game.' },
  ],
};

describe('companion prompt core', () => {
  it('filters signals to real in-app sources', () => {
    expect(filterAllowedSignals([
      { source: 'friendGraph', statement: 'Greg is in this room.' },
      { source: 'sessionTelemetry', statement: 'The last run lasted 42 seconds.' },
      { source: 'external', statement: 'The player is near a school.' },
    ])).toEqual([
      { source: 'friendGraph', statement: 'Greg is in this room.' },
      { source: 'sessionTelemetry', statement: 'The last run lasted 42 seconds.' },
    ]);
  });

  it('filters memory to bounded companion customization', () => {
    expect(filterAllowedMemory(profile.memory)).toEqual([
      { source: 'gameplay', statement: 'The player likes launching blocks into towers.' },
      { source: 'personalityAdjustment', statement: 'The player prefers gentler teasing.' },
    ]);
  });

  it('composes common guardrails with profile customization and allowed context', () => {
    const messages = composeCompanionPrompt(profile, {
      signals: [
        { source: 'gameplay', statement: 'This recipe is cold.' },
        { source: 'external', statement: 'The player lives downtown.' },
      ],
    });
    const prompt = messages.map((message) => message.content).join('\n');

    expect(prompt).toContain('Name: Bunzo');
    expect(prompt).toContain('bright, silly, and brave');
    expect(prompt).toContain('Speak only from supplied in-app signals');
    expect(prompt).toContain('This recipe is cold.');
    expect(prompt).not.toContain('downtown');
    expect(prompt).not.toContain('soccer game');
  });
});
