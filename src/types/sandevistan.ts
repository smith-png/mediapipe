export type TriggerId =
  | 'frown'
  | 'smile'
  | 'mouthOpen'
  | 'eyebrowsUp'
  | 'leftWink'
  | 'rightWink'
  | 'cheekPuff'
  | 'tongueOut'
  | 'squint'
  | 'fist'
  | 'peaceSign';

export type TriggerCategory = 'face' | 'gesture';

export type CameraFacing = 'user' | 'environment';

export interface TriggerOption {
  id: TriggerId;
  label: string;
  category: TriggerCategory;
  description: string;
}

export interface SandevistanSettings {
  trigger: TriggerId;
  threshold: number;
  trailLength: number;
  trailSpacing: number;
  glowEnabled: boolean;
  cameraFacing: CameraFacing;
  recordAudio: boolean;
}

export type CameraStatus =
  | 'idle'
  | 'requesting'
  | 'loading-models'
  | 'active'
  | 'error';

export interface CameraErrorInfo {
  title: string;
  message: string;
  hint: string;
}

export interface RecordedClip {
  blob: Blob;
  url: string;
  mimeType: string;
  extension: 'mp4' | 'webm';
  filename: string;
  durationMs: number;
  isWebmFallback: boolean;
}
