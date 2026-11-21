import type { RecordedClip } from '../types/sandevistan';

export const MAX_RECORDING_MS = 30_000;
const VIDEO_BITS_PER_SECOND = 4_000_000;

interface MimeChoice {
  mimeType: string;
  extension: 'mp4' | 'webm';
  isWebmFallback: boolean;
}

const VIDEO_ONLY_CANDIDATES: MimeChoice[] = [
  { mimeType: 'video/mp4;codecs=avc1', extension: 'mp4', isWebmFallback: false },
  { mimeType: 'video/mp4', extension: 'mp4', isWebmFallback: false },
  { mimeType: 'video/webm;codecs=vp9', extension: 'webm', isWebmFallback: true },
  { mimeType: 'video/webm', extension: 'webm', isWebmFallback: true },
];

const VIDEO_AUDIO_CANDIDATES: MimeChoice[] = [
  {
    mimeType: 'video/mp4;codecs=avc1,mp4a.40.2',
    extension: 'mp4',
    isWebmFallback: false,
  },
  { mimeType: 'video/mp4;codecs=avc1', extension: 'mp4', isWebmFallback: false },
  { mimeType: 'video/mp4', extension: 'mp4', isWebmFallback: false },
  {
    mimeType: 'video/webm;codecs=vp9,opus',
    extension: 'webm',
    isWebmFallback: true,
  },
  { mimeType: 'video/webm;codecs=vp9', extension: 'webm', isWebmFallback: true },
  { mimeType: 'video/webm', extension: 'webm', isWebmFallback: true },
];

function pickSupportedMime(withAudio: boolean): MimeChoice | null {
  if (typeof MediaRecorder === 'undefined') {
    return null;
  }
  const canCheck = typeof MediaRecorder.isTypeSupported === 'function';
  const candidates = withAudio ? VIDEO_AUDIO_CANDIDATES : VIDEO_ONLY_CANDIDATES;

  if (canCheck) {
    for (const candidate of candidates) {
      try {
        if (MediaRecorder.isTypeSupported(candidate.mimeType)) {
          return candidate;
        }
      } catch {
        // Ignore malformed codec checks on older browsers
      }
    }
  }

  // Fallback to browser default container when isTypeSupported reports none
  return { mimeType: '', extension: 'webm', isWebmFallback: true };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function buildRecordingFilename(extension: 'mp4' | 'webm'): string {
  const now = new Date();
  const y = now.getFullYear();
  const mo = pad2(now.getMonth() + 1);
  const d = pad2(now.getDate());
  const h = pad2(now.getHours());
  const mi = pad2(now.getMinutes());
  const s = pad2(now.getSeconds());
  return `sandevistan-${y}${mo}${d}-${h}${mi}${s}.${extension}`;
}

export function canShareFile(clip: RecordedClip): boolean {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.share !== 'function' ||
    typeof navigator.canShare !== 'function' ||
    typeof File === 'undefined'
  ) {
    return false;
  }
  try {
    const file = new File([clip.blob], clip.filename, {
      type: clip.mimeType || (clip.extension === 'mp4' ? 'video/mp4' : 'video/webm'),
    });
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export interface CanvasRecorderCallbacks {
  onComplete: (clip: RecordedClip) => void;
  onError: (message: string) => void;
  onNotice?: (message: string) => void;
}

export class CanvasRecorder {
  private recorder: MediaRecorder | null = null;
  private canvasStream: MediaStream | null = null;
  private micStream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private autoStopTimer: number | null = null;
  private startedAt = 0;
  private recording = false;
  private chosenChoice: MimeChoice = {
    mimeType: '',
    extension: 'webm',
    isWebmFallback: true,
  };

  isRecording(): boolean {
    return this.recording;
  }

  getElapsedMs(): number {
    if (!this.recording) return 0;
    return Math.min(MAX_RECORDING_MS, Math.max(0, performance.now() - this.startedAt));
  }

  async start(
    canvas: HTMLCanvasElement,
    recordAudio: boolean,
    callbacks: CanvasRecorderCallbacks
  ): Promise<boolean> {
    if (this.recording) return false;

    if (
      typeof MediaRecorder === 'undefined' ||
      typeof canvas.captureStream !== 'function'
    ) {
      callbacks.onError(
        'Video recording is not supported in this browser. Try Chrome or Safari.'
      );
      return false;
    }

    let micStream: MediaStream | null = null;
    if (recordAudio) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
      } catch {
        callbacks.onNotice?.(
          'Microphone access denied — recording video without audio.'
        );
      }
    }

    let canvasStream: MediaStream;
    try {
      canvasStream = canvas.captureStream(30);
    } catch {
      micStream?.getTracks().forEach((t) => t.stop());
      callbacks.onError('Unable to capture canvas stream for recording.');
      return false;
    }

    const combinedTracks: MediaStreamTrack[] = [
      ...canvasStream.getVideoTracks(),
      ...(micStream ? micStream.getAudioTracks() : []),
    ];

    if (combinedTracks.length === 0) {
      canvasStream.getTracks().forEach((t) => t.stop());
      micStream?.getTracks().forEach((t) => t.stop());
      callbacks.onError('No active video track available to record.');
      return false;
    }

    const combinedStream = new MediaStream(combinedTracks);
    const hasAudio = Boolean(micStream && micStream.getAudioTracks().length > 0);
    const choice = pickSupportedMime(hasAudio);

    if (!choice) {
      canvasStream.getTracks().forEach((t) => t.stop());
      micStream?.getTracks().forEach((t) => t.stop());
      callbacks.onError('Video recording is not supported in this browser.');
      return false;
    }

    let recorder: MediaRecorder;
    try {
      const options: MediaRecorderOptions = {
        videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
      };
      if (choice.mimeType) {
        options.mimeType = choice.mimeType;
      }
      recorder = new MediaRecorder(combinedStream, options);
    } catch {
      // Retry without explicit codec string if the browser rejected the codec+audio pair
      try {
        recorder = new MediaRecorder(combinedStream, {
          videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
        });
      } catch {
        canvasStream.getTracks().forEach((t) => t.stop());
        micStream?.getTracks().forEach((t) => t.stop());
        callbacks.onError('Could not start video recorder on this device.');
        return false;
      }
    }

    this.chunks = [];
    this.canvasStream = canvasStream;
    this.micStream = micStream;
    this.recorder = recorder;
    this.chosenChoice = choice;
    this.startedAt = performance.now();
    this.recording = true;

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };

    recorder.onerror = () => {
      this.cleanupStreams();
      this.recording = false;
      this.chunks = [];
      callbacks.onError('Recording stopped due to a browser encoder error.');
    };

    recorder.onstop = () => {
      const durationMs = Math.min(
        MAX_RECORDING_MS,
        Math.max(0, performance.now() - this.startedAt)
      );
      const recordedChunks = this.chunks;
      this.chunks = [];
      const actualMime =
        recorder.mimeType ||
        this.chosenChoice.mimeType ||
        (this.chosenChoice.extension === 'mp4' ? 'video/mp4' : 'video/webm');
      const isMp4 = actualMime.toLowerCase().includes('mp4');
      const extension: 'mp4' | 'webm' = isMp4 ? 'mp4' : 'webm';
      const isWebmFallback = !isMp4;

      this.cleanupStreams();
      this.recording = false;

      if (recordedChunks.length === 0) {
        callbacks.onError('Recording was too short to save.');
        return;
      }

      const blob = new Blob(recordedChunks, { type: actualMime });
      if (blob.size === 0) {
        callbacks.onError('Recorded video was empty.');
        return;
      }

      const url = URL.createObjectURL(blob);
      const filename = buildRecordingFilename(extension);

      callbacks.onComplete({
        blob,
        url,
        mimeType: actualMime,
        extension,
        filename,
        durationMs,
        isWebmFallback,
      });
    };

    try {
      recorder.start(250);
    } catch {
      this.cleanupStreams();
      this.recording = false;
      this.chunks = [];
      callbacks.onError('Failed to begin video capture.');
      return false;
    }

    this.autoStopTimer = window.setTimeout(() => {
      this.stop();
    }, MAX_RECORDING_MS);

    return true;
  }

  stop(): void {
    if (this.autoStopTimer !== null) {
      window.clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }
    if (this.recorder && this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop();
      } catch {
        this.cleanupStreams();
        this.recording = false;
        this.chunks = [];
      }
    } else {
      this.cleanupStreams();
      this.recording = false;
    }
  }

  dispose(): void {
    if (this.autoStopTimer !== null) {
      window.clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }
    if (this.recorder) {
      this.recorder.ondataavailable = null;
      this.recorder.onstop = null;
      this.recorder.onerror = null;
      if (this.recorder.state !== 'inactive') {
        try {
          this.recorder.stop();
        } catch {
          // Ignore stop errors during unmount
        }
      }
    }
    this.cleanupStreams();
    this.chunks = [];
    this.recording = false;
  }

  private cleanupStreams(): void {
    if (this.autoStopTimer !== null) {
      window.clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }
    this.canvasStream?.getTracks().forEach((t) => t.stop());
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.canvasStream = null;
    this.micStream = null;
    this.recorder = null;
  }
}
