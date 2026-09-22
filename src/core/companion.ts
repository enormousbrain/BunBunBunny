export type CompanionSignalSource =
  | 'friendGraph'
  | 'gameplay'
  | 'playerProfile'
  | 'sessionTelemetry'
  | 'external';

export type CompanionMemorySource =
  | 'explicitPlayerPreference'
  | 'gameplay'
  | 'personalityAdjustment'
  | 'external';

export type CompanionPromptRole = 'system' | 'user';

export type CompanionSignal = {
  readonly source: CompanionSignalSource;
  readonly statement: string;
};

export type CompanionMemory = {
  readonly source: CompanionMemorySource;
  readonly statement: string;
};

export type CompanionProfile = {
  readonly name: string;
  readonly style: string;
  readonly traits: readonly string[];
  readonly boundaries: readonly string[];
  readonly memory: readonly CompanionMemory[];
};

export type CompanionContext = {
  readonly signals: readonly CompanionSignal[];
};

export type CompanionPromptMessage = {
  readonly role: CompanionPromptRole;
  readonly content: string;
};

const allowedSignalSources: readonly CompanionSignalSource[] = [
  'friendGraph',
  'gameplay',
  'playerProfile',
  'sessionTelemetry',
];

const allowedMemorySources: readonly CompanionMemorySource[] = [
  'explicitPlayerPreference',
  'gameplay',
  'personalityAdjustment',
];

export const filterAllowedSignals = (
  signals: readonly CompanionSignal[],
): readonly CompanionSignal[] =>
  signals.filter((signal) => allowedSignalSources.includes(signal.source));

export const filterAllowedMemory = (
  memory: readonly CompanionMemory[],
): readonly CompanionMemory[] =>
  memory.filter((entry) => allowedMemorySources.includes(entry.source));

const listBlock = (label: string, values: readonly string[]): string =>
  values.length === 0
    ? `${label}\n- None supplied.`
    : `${label}\n${values.map((value) => `- ${value}`).join('\n')}`;

export const composeCompanionPrompt = (
  profile: CompanionProfile,
  context: CompanionContext,
): readonly CompanionPromptMessage[] => {
  const memory = filterAllowedMemory(profile.memory).map((entry) => entry.statement);
  const signals = filterAllowedSignals(context.signals).map((signal) => signal.statement);

  return [
    {
      role: 'system',
      content: [
        'You are the player\'s Bun Bun Bunny companion: loyal, playful, and focused on play.',
        'Speak only from supplied in-app signals. Never invent facts about the player, friends, locations, bodies, private life, or events outside the app.',
        'Encourage by default. Celebrate more than you tease. Tease only as a warm invitation to play, never as mockery.',
        'You are a friend the player plays with, not a friend they confide in.',
      ].join('\n'),
    },
    {
      role: 'system',
      content: [
        `CompanionProfile\nName: ${profile.name}\nStyle: ${profile.style}`,
        listBlock('Personality Traits', profile.traits),
        listBlock('Boundaries', profile.boundaries),
        listBlock('Allowed Memory', memory),
      ].join('\n\n'),
    },
    {
      role: 'user',
      content: listBlock('Current In-App Signals', signals),
    },
  ];
};
