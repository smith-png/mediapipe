import type { SandevistanSettings, TriggerId, TriggerOption } from '../types/sandevistan';

const STORAGE_KEY = 'sandevistan_cam_settings_v1';

export const TRIGGER_OPTIONS: TriggerOption[] = [
  {
    id: 'mouthOpen',
    label: 'Mouth open',
    category: 'face',
    description: 'Open your mouth wide',
  },
  {
    id: 'frown',
    label: 'Frown',
    category: 'face',
    description: 'Pull both eyebrows down',
  },
  {
    id: 'smile',
    label: 'Smile',
    category: 'face',
    description: 'Smile wide',
  },
  {
    id: 'eyebrowsUp',
    label: 'Eyebrows up',
    category: 'face',
    description: 'Raise your inner eyebrows',
  },
  {
    id: 'leftWink',
    label: 'Left wink',
    category: 'face',
    description: 'Wink your left eye while keeping right open',
  },
  {
    id: 'rightWink',
    label: 'Right wink',
    category: 'face',
    description: 'Wink your right eye while keeping left open',
  },
  {
    id: 'cheekPuff',
    label: 'Cheek puff',
    category: 'face',
    description: 'Puff out your cheeks',
  },
  {
    id: 'tongueOut',
    label: 'Tongue out',
    category: 'face',
    description: 'Stick your tongue out',
  },
  {
    id: 'squint',
    label: 'Squint',
    category: 'face',
    description: 'Squint both eyes',
  },
  {
    id: 'fist',
    label: 'Fist',
    category: 'gesture',
    description: 'Hold up a closed fist',
  },
  {
    id: 'peaceSign',
    label: 'Peace sign',
    category: 'gesture',
    description: 'Hold up a peace sign',
  },
];

const VALID_TRIGGER_IDS = new Set<string>(TRIGGER_OPTIONS.map((opt) => opt.id));

export const DEFAULT_SETTINGS: SandevistanSettings = {
  trigger: 'mouthOpen',
  threshold: 0.5,
  trailLength: 12,
  trailSpacing: 14,
  glowEnabled: true,
};

export function isGestureTrigger(trigger: TriggerId): boolean {
  return trigger === 'fist' || trigger === 'peaceSign';
}

export function getTriggerOption(trigger: TriggerId): TriggerOption {
  return TRIGGER_OPTIONS.find((opt) => opt.id === trigger) ?? TRIGGER_OPTIONS[0];
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

export function loadSettings(): SandevistanSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };

    const parsed = JSON.parse(raw) as Partial<SandevistanSettings>;
    const trigger: TriggerId =
      typeof parsed.trigger === 'string' && VALID_TRIGGER_IDS.has(parsed.trigger)
        ? (parsed.trigger as TriggerId)
        : DEFAULT_SETTINGS.trigger;

    const threshold =
      typeof parsed.threshold === 'number' && Number.isFinite(parsed.threshold)
        ? clamp(parsed.threshold, 0.1, 0.95)
        : DEFAULT_SETTINGS.threshold;

    const trailLength =
      typeof parsed.trailLength === 'number' && Number.isFinite(parsed.trailLength)
        ? Math.round(clamp(parsed.trailLength, 4, 20))
        : DEFAULT_SETTINGS.trailLength;

    const trailSpacing =
      typeof parsed.trailSpacing === 'number' && Number.isFinite(parsed.trailSpacing)
        ? Math.round(clamp(parsed.trailSpacing, 2, 36))
        : DEFAULT_SETTINGS.trailSpacing;

    const glowEnabled =
      typeof parsed.glowEnabled === 'boolean'
        ? parsed.glowEnabled
        : DEFAULT_SETTINGS.glowEnabled;

    return {
      trigger,
      threshold,
      trailLength,
      trailSpacing,
      glowEnabled,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: SandevistanSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors in restricted/private contexts
  }
}
