import type {
  Category,
  FaceLandmarkerResult,
  GestureRecognizerResult,
} from '@mediapipe/tasks-vision';
import type { TriggerId } from '../types/sandevistan';

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function getBlendshapeScore(categories: Category[], name: string): number {
  for (let i = 0; i < categories.length; i++) {
    if (categories[i].categoryName === name) {
      return categories[i].score;
    }
  }
  return 0;
}

/**
 * Computes a normalized [0, 1] trigger value for face blendshape triggers.
 */
export function evaluateFaceTrigger(
  trigger: TriggerId,
  result: FaceLandmarkerResult
): number {
  const categories = result.faceBlendshapes?.[0]?.categories;
  if (!categories || categories.length === 0) {
    return 0;
  }

  switch (trigger) {
    case 'frown': {
      const left = getBlendshapeScore(categories, 'browDownLeft');
      const right = getBlendshapeScore(categories, 'browDownRight');
      return clamp01((left + right) * 0.5);
    }
    case 'smile': {
      const left = getBlendshapeScore(categories, 'mouthSmileLeft');
      const right = getBlendshapeScore(categories, 'mouthSmileRight');
      return clamp01((left + right) * 0.5);
    }
    case 'mouthOpen': {
      return clamp01(getBlendshapeScore(categories, 'jawOpen'));
    }
    case 'eyebrowsUp': {
      return clamp01(getBlendshapeScore(categories, 'browInnerUp'));
    }
    case 'leftWink': {
      const leftBlink = getBlendshapeScore(categories, 'eyeBlinkLeft');
      const rightBlink = getBlendshapeScore(categories, 'eyeBlinkRight');
      // High when left eye is closed AND right eye remains open (prevents triggering on both-eye blinks)
      const rightOpenFactor =
        rightBlink <= 0.3
          ? 1
          : Math.max(0, 1 - (rightBlink - 0.3) / 0.25);
      return clamp01(leftBlink * rightOpenFactor);
    }
    case 'rightWink': {
      const rightBlink = getBlendshapeScore(categories, 'eyeBlinkRight');
      const leftBlink = getBlendshapeScore(categories, 'eyeBlinkLeft');
      // High when right eye is closed AND left eye remains open
      const leftOpenFactor =
        leftBlink <= 0.3
          ? 1
          : Math.max(0, 1 - (leftBlink - 0.3) / 0.25);
      return clamp01(rightBlink * leftOpenFactor);
    }
    case 'cheekPuff': {
      return clamp01(getBlendshapeScore(categories, 'cheekPuff'));
    }
    case 'tongueOut': {
      return clamp01(getBlendshapeScore(categories, 'tongueOut'));
    }
    case 'squint': {
      const left = getBlendshapeScore(categories, 'eyeSquintLeft');
      const right = getBlendshapeScore(categories, 'eyeSquintRight');
      return clamp01((left + right) * 0.5);
    }
    default:
      return 0;
  }
}

/**
 * Computes a normalized [0, 1] trigger value for hand gesture triggers.
 */
export function evaluateGestureTrigger(
  trigger: TriggerId,
  result: GestureRecognizerResult
): number {
  const gestureLists = result.gestures;
  if (!gestureLists || gestureLists.length === 0) {
    return 0;
  }

  const targetName =
    trigger === 'fist'
      ? 'Closed_Fist'
      : trigger === 'peaceSign'
        ? 'Victory'
        : null;

  if (!targetName) return 0;

  let bestScore = 0;
  for (let handIdx = 0; handIdx < gestureLists.length; handIdx++) {
    const handGestures = gestureLists[handIdx];
    for (let i = 0; i < handGestures.length; i++) {
      const g = handGestures[i];
      if (g.categoryName === targetName && g.score > bestScore) {
        bestScore = g.score;
      }
    }
  }
  return clamp01(bestScore);
}

/**
 * Asymmetric frame hysteresis:
 * - Turns ON after 3 consecutive frames >= threshold
 * - Turns OFF after 10 consecutive frames < threshold
 */
export class TriggerSmoother {
  private active = false;
  private aboveFrames = 0;
  private belowFrames = 0;
  private readonly onConsecutiveFrames: number;
  private readonly offConsecutiveFrames: number;

  constructor(onConsecutiveFrames = 3, offConsecutiveFrames = 10) {
    this.onConsecutiveFrames = onConsecutiveFrames;
    this.offConsecutiveFrames = offConsecutiveFrames;
  }

  update(value: number, threshold: number): boolean {
    if (!this.active) {
      if (value >= threshold) {
        this.aboveFrames += 1;
        if (this.aboveFrames >= this.onConsecutiveFrames) {
          this.active = true;
          this.aboveFrames = 0;
          this.belowFrames = 0;
        }
      } else {
        this.aboveFrames = 0;
      }
    } else {
      if (value < threshold) {
        this.belowFrames += 1;
        if (this.belowFrames >= this.offConsecutiveFrames) {
          this.active = false;
          this.belowFrames = 0;
          this.aboveFrames = 0;
        }
      } else {
        this.belowFrames = 0;
      }
    }

    return this.active;
  }

  isActive(): boolean {
    return this.active;
  }

  reset(): void {
    this.active = false;
    this.aboveFrames = 0;
    this.belowFrames = 0;
  }
}
