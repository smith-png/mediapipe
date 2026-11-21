import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RefreshCw,
  SlidersHorizontal,
  VideoOff,
  X,
} from 'lucide-react';
import {
  CanvasRecorder,
  MAX_RECORDING_MS,
} from './engine/canvasRecorder';
import { VisionEngine } from './engine/mediapipe';
import { SandevistanRenderer } from './engine/sandevistanRenderer';
import {
  TriggerSmoother,
  evaluateFaceTrigger,
  evaluateGestureTrigger,
} from './engine/triggerEvaluator';
import {
  RecordingHud,
  type RecordingHudHandle,
} from './components/RecordingHud';
import { RecordingPreviewModal } from './components/RecordingPreviewModal';
import { SandevistanBadge } from './components/SandevistanBadge';
import {
  SettingsPanel,
  type LiveMeterHandle,
} from './components/SettingsPanel';
import { StartOverlay } from './components/StartOverlay';
import type {
  CameraErrorInfo,
  CameraFacing,
  CameraStatus,
  RecordedClip,
  SandevistanSettings,
} from './types/sandevistan';
import {
  isGestureTrigger,
  loadSettings,
  saveSettings,
} from './utils/settings';

// Target ~30 fps processing interval for smooth mobile performance
const TARGET_FRAME_MS = 1000 / 32;

function describeCameraError(err: unknown): CameraErrorInfo {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return {
      title: 'Secure connection required',
      message:
        'Mobile browsers only allow webcam access over HTTPS or localhost.',
      hint: 'Open this app over HTTPS and tap Start Camera again.',
    };
  }

  const domErr = err as { name?: string; message?: string } | null;
  const name = domErr?.name ?? '';

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return {
      title: 'Camera permission denied',
      message:
        'Access to the camera was blocked. Allow camera permission to run the Sandevistan effect.',
      hint: 'In Chrome, tap the lock or tune icon next to the address bar, set Camera to Allow, then tap Try Again.',
    };
  }

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return {
      title: 'No camera detected',
      message: 'We could not find a camera on this device.',
      hint: 'Check that a webcam is connected and enabled in your device settings.',
    };
  }

  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return {
      title: 'Camera is busy',
      message: 'Another app or browser tab is currently using the camera.',
      hint: 'Close other apps using the camera and tap Try Again.',
    };
  }

  return {
    title: 'Unable to start camera',
    message:
      domErr?.message ||
      'An unexpected error occurred while initializing the camera or vision models.',
    hint: 'Check your internet connection (needed once to download MediaPipe models) and tap Try Again.',
  };
}

interface AcquiredCameraResult {
  stream: MediaStream;
  actualFacing: CameraFacing;
  fellBackToFront: boolean;
}

async function requestStreamForFacing(
  facing: CameraFacing
): Promise<MediaStream> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Camera API is unavailable in this browser context.');
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30, max: 30 },
      },
      audio: false,
    });
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    if (
      name === 'OverconstrainedError' ||
      name === 'ConstraintNotSatisfiedError'
    ) {
      return await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing } },
        audio: false,
      });
    }
    throw err;
  }
}

async function acquireCameraStream(
  requestedFacing: CameraFacing
): Promise<AcquiredCameraResult> {
  if (requestedFacing === 'user') {
    const stream = await requestStreamForFacing('user');
    return { stream, actualFacing: 'user', fellBackToFront: false };
  }

  // Rear camera requested: use facingMode: { ideal: 'environment' } and detect fallback cleanly
  try {
    const stream = await requestStreamForFacing('environment');
    const videoTrack = stream.getVideoTracks()[0];
    const trackFacing = videoTrack?.getSettings?.().facingMode;

    if (trackFacing === 'user') {
      return { stream, actualFacing: 'user', fellBackToFront: true };
    }

    if (!trackFacing && navigator.mediaDevices?.enumerateDevices) {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((d) => d.kind === 'videoinput');
        if (videoInputs.length <= 1) {
          return { stream, actualFacing: 'user', fellBackToFront: true };
        }
      } catch {
        // Ignore device enumeration errors
      }
    }

    return { stream, actualFacing: 'environment', fellBackToFront: false };
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    // Propagate permission denials rather than retrying
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      throw err;
    }
    // Fall back to front camera when rear camera is unavailable
    const fallbackStream = await requestStreamForFacing('user');
    return {
      stream: fallbackStream,
      actualFacing: 'user',
      fellBackToFront: true,
    };
  }
}

export default function App() {
  const [settings, setSettings] = useState<SandevistanSettings>(() =>
    loadSettings()
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle');
  const [cameraError, setCameraError] = useState<CameraErrorInfo | null>(null);
  const [sandevistanActive, setSandevistanActive] = useState(false);
  const [gestureModelLoading, setGestureModelLoading] = useState(false);
  const [cameraSwitching, setCameraSwitching] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedClip, setRecordedClip] = useState<RecordedClip | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveMeterRef = useRef<LiveMeterHandle | null>(null);
  const recordingHudRef = useRef<RecordingHudHandle | null>(null);

  const settingsRef = useRef<SandevistanSettings>(settings);
  const streamRef = useRef<MediaStream | null>(null);
  const visionRef = useRef<VisionEngine | null>(null);
  const rendererRef = useRef<SandevistanRenderer | null>(null);
  const recorderRef = useRef<CanvasRecorder>(new CanvasRecorder());
  const smootherRef = useRef<TriggerSmoother>(new TriggerSmoother(3, 10));
  const rafIdRef = useRef<number | null>(null);
  const activeUiStateRef = useRef(false);
  const cameraStatusRef = useRef<CameraStatus>(cameraStatus);
  const activeStreamFacingRef = useRef<CameraFacing>(settings.cameraFacing);
  const isSwitchingCameraRef = useRef(false);
  const toastTimerRef = useRef<number | null>(null);
  const recordedClipRef = useRef<RecordedClip | null>(null);

  cameraStatusRef.current = cameraStatus;

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 4200);
  }, []);

  const handleClosePreview = useCallback(() => {
    if (recordedClipRef.current) {
      URL.revokeObjectURL(recordedClipRef.current.url);
      recordedClipRef.current = null;
    }
    setRecordedClip(null);
  }, []);

  const switchActiveCamera = useCallback(
    async (targetFacing: CameraFacing) => {
      if (
        cameraStatusRef.current !== 'active' ||
        isSwitchingCameraRef.current
      ) {
        return;
      }

      isSwitchingCameraRef.current = true;
      setCameraSwitching(true);

      // Stop old stream tracks first (mobile Chrome often refuses opening rear while front is held)
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }

      try {
        const { stream, actualFacing, fellBackToFront } =
          await acquireCameraStream(targetFacing);
        streamRef.current = stream;
        activeStreamFacingRef.current = actualFacing;

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }

        rendererRef.current?.clearTrails();

        if (fellBackToFront) {
          showToast('Rear camera unavailable — using front camera');
          if (settingsRef.current.cameraFacing !== actualFacing) {
            setSettings((prev) => ({ ...prev, cameraFacing: actualFacing }));
          }
        }
      } catch (err) {
        // If switching failed, try restoring front camera so the user isn't left stranded
        try {
          const fallback = await requestStreamForFacing('user');
          streamRef.current = fallback;
          activeStreamFacingRef.current = 'user';
          const video = videoRef.current;
          if (video) {
            video.srcObject = fallback;
            await video.play();
          }
          rendererRef.current?.clearTrails();
          setSettings((prev) => ({ ...prev, cameraFacing: 'user' }));
          showToast('Rear camera unavailable — using front camera');
        } catch {
          setCameraError(describeCameraError(err));
          setCameraStatus('error');
        }
      } finally {
        isSwitchingCameraRef.current = false;
        setCameraSwitching(false);
      }
    },
    [showToast]
  );

  // Sync settings ref + persist to localStorage + react to trigger/camera switches
  useEffect(() => {
    const prevTrigger = settingsRef.current.trigger;
    settingsRef.current = settings;
    saveSettings(settings);

    if (prevTrigger !== settings.trigger) {
      smootherRef.current.reset();
      if (activeUiStateRef.current) {
        activeUiStateRef.current = false;
        setSandevistanActive(false);
      }
      liveMeterRef.current?.update(0, settings.threshold, false);

      // Lazily load GestureRecognizer only when a hand-gesture trigger is selected
      if (
        isGestureTrigger(settings.trigger) &&
        visionRef.current &&
        !visionRef.current.getGestureRecognizer()
      ) {
        setGestureModelLoading(true);
        visionRef.current
          .ensureGestureRecognizer()
          .catch((err) => {
            console.error('Failed to load GestureRecognizer:', err);
          })
          .finally(() => {
            setGestureModelLoading(false);
          });
      }
    }

    if (
      settings.cameraFacing !== activeStreamFacingRef.current &&
      cameraStatusRef.current === 'active'
    ) {
      void switchActiveCamera(settings.cameraFacing);
    }
  }, [settings, switchActiveCamera]);

  const handleFlipCamera = useCallback(() => {
    if (isSwitchingCameraRef.current) return;
    setSettings((prev) => ({
      ...prev,
      cameraFacing: prev.cameraFacing === 'user' ? 'environment' : 'user',
    }));
  }, []);

  // Keep full-screen canvas sized to viewport with capped DPR for 30fps mobile fill-rate
  const syncCanvasSize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.round(window.innerWidth * dpr));
    const height = Math.max(1, Math.round(window.innerHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }, []);

  useEffect(() => {
    syncCanvasSize();
    window.addEventListener('resize', syncCanvasSize);
    window.addEventListener('orientationchange', syncCanvasSize);
    return () => {
      window.removeEventListener('resize', syncCanvasSize);
      window.removeEventListener('orientationchange', syncCanvasSize);
    };
  }, [syncCanvasSize]);

  // Stop any active recording when the tab becomes hidden, keeping what was recorded so far
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && recorderRef.current.isRecording()) {
        recorderRef.current.stop();
        setIsRecording(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const handleToggleRecord = useCallback(async () => {
    const recorder = recorderRef.current;
    if (recorder.isRecording()) {
      recorder.stop();
      setIsRecording(false);
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas || cameraStatusRef.current !== 'active') return;

    // Close any previous preview clip before starting a new recording
    if (recordedClipRef.current) {
      URL.revokeObjectURL(recordedClipRef.current.url);
      recordedClipRef.current = null;
      setRecordedClip(null);
    }

    const started = await recorder.start(
      canvas,
      settingsRef.current.recordAudio,
      {
        onComplete: (clip) => {
          setIsRecording(false);
          if (recordedClipRef.current) {
            URL.revokeObjectURL(recordedClipRef.current.url);
          }
          recordedClipRef.current = clip;
          setRecordedClip(clip);
          if (clip.isWebmFallback) {
            showToast(
              'Your browser does not support MP4 recording — saved as WebM instead.'
            );
          }
        },
        onError: (message) => {
          setIsRecording(false);
          showToast(message);
        },
        onNotice: (message) => {
          showToast(message);
        },
      }
    );

    if (started) {
      setIsRecording(true);
      recordingHudRef.current?.update(0, MAX_RECORDING_MS);
    }
  }, [showToast]);

  const stopCamera = useCallback(() => {
    // Stop any active recording first so recorded footage is preserved
    if (recorderRef.current.isRecording()) {
      recorderRef.current.stop();
      setIsRecording(false);
    }

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    smootherRef.current.reset();
    rendererRef.current?.clearTrails();
    activeUiStateRef.current = false;
    setSandevistanActive(false);
    setCameraStatus('idle');
    setCameraError(null);
    liveMeterRef.current?.update(0, settingsRef.current.threshold, false);
  }, []);

  // Cleanup everything on unmount
  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      recorderRef.current.dispose();
      if (recordedClipRef.current) {
        URL.revokeObjectURL(recordedClipRef.current.url);
        recordedClipRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      visionRef.current?.dispose();
      visionRef.current = null;
    };
  }, []);

  const startProcessingLoop = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }

    let lastProcessedMs = 0;
    let lastVideoTime = -1;
    let lastMediaPipeTs = 0;
    let hasSegmentation = false;

    const tick = (now: number) => {
      rafIdRef.current = requestAnimationFrame(tick);

      if (document.hidden) return;

      // Update recording timer and progress bar imperatively (zero React re-renders)
      if (recorderRef.current.isRecording()) {
        recordingHudRef.current?.update(
          recorderRef.current.getElapsedMs(),
          MAX_RECORDING_MS
        );
      }

      if (isSwitchingCameraRef.current) {
        lastVideoTime = -1;
        return;
      }
      if (now - lastProcessedMs < TARGET_FRAME_MS) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const vision = visionRef.current;
      const renderer = rendererRef.current;

      if (
        !video ||
        !canvas ||
        !vision ||
        !renderer ||
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        video.videoWidth === 0 ||
        video.videoHeight === 0
      ) {
        return;
      }

      // Avoid running duplicate ML inference on the exact same camera frame
      if (video.currentTime === lastVideoTime) {
        return;
      }
      lastVideoTime = video.currentTime;
      lastProcessedMs = now;

      const displayCtx = canvas.getContext('2d', { alpha: false });
      if (!displayCtx) return;

      const currentSettings = settingsRef.current;
      const shouldMirror = currentSettings.cameraFacing === 'user';

      renderer.syncProcessingResolution(video.videoWidth, video.videoHeight);
      renderer.captureMirroredFrame(video, shouldMirror);

      // MediaPipe requires strictly monotonically increasing timestamps (in ms)
      const ts = Math.max(Math.round(now), lastMediaPipeTs + 1);
      lastMediaPipeTs = ts;

      const useGesture = isGestureTrigger(currentSettings.trigger);
      let triggerValue = 0;
      let faceNoseX: number | undefined;
      let faceNoseY: number | undefined;

      // Only run GestureRecognizer when a gesture trigger is selected;
      // only run FaceLandmarker when a face trigger is selected.
      if (useGesture) {
        const gestureRecognizer = vision.getGestureRecognizer();
        if (gestureRecognizer) {
          try {
            const gestureResult = gestureRecognizer.recognizeForVideo(video, ts);
            triggerValue = evaluateGestureTrigger(
              currentSettings.trigger,
              gestureResult
            );
          } catch (err) {
            console.warn('GestureRecognizer frame error:', err);
          }
        }
      } else {
        const faceLandmarker = vision.getFaceLandmarker();
        if (faceLandmarker) {
          try {
            const faceResult = faceLandmarker.detectForVideo(video, ts);
            triggerValue = evaluateFaceTrigger(
              currentSettings.trigger,
              faceResult
            );
            const nose = faceResult.faceLandmarks?.[0]?.[1];
            if (nose) {
              faceNoseX = nose.x;
              faceNoseY = nose.y;
            }
          } catch (err) {
            console.warn('FaceLandmarker frame error:', err);
          }
        }
      }

      const isActive = smootherRef.current.update(
        triggerValue,
        currentSettings.threshold
      );

      // Update live value meter directly via ref (zero React re-renders per frame)
      liveMeterRef.current?.update(
        triggerValue,
        currentSettings.threshold,
        isActive
      );

      if (isActive !== activeUiStateRef.current) {
        activeUiStateRef.current = isActive;
        setSandevistanActive(isActive);
      }

      // Run Selfie ImageSegmenter only while Sandevistan is ON (or smoothly fading out)
      if (isActive || renderer.isBlending()) {
        const segmenter = vision.getImageSegmenter();
        if (segmenter) {
          try {
            segmenter.segmentForVideo(video, ts, (segResult) => {
              hasSegmentation = renderer.processSegmentation(
                segResult,
                vision.getPersonMaskIndex(),
                currentSettings,
                faceNoseX,
                faceNoseY
              );
            });
          } catch (err) {
            console.warn('ImageSegmenter frame error:', err);
          }
        }
      } else {
        hasSegmentation = false;
      }

      renderer.render(
        canvas,
        displayCtx,
        isActive,
        hasSegmentation,
        currentSettings
      );
    };

    rafIdRef.current = requestAnimationFrame(tick);
  }, []);

  const handleStartCamera = useCallback(async () => {
    setCameraError(null);
    setCameraStatus('requesting');

    try {
      const { stream, actualFacing, fellBackToFront } =
        await acquireCameraStream(settingsRef.current.cameraFacing);
      streamRef.current = stream;
      activeStreamFacingRef.current = actualFacing;

      if (fellBackToFront) {
        showToast('Rear camera unavailable — using front camera');
        if (settingsRef.current.cameraFacing !== actualFacing) {
          setSettings((prev) => ({ ...prev, cameraFacing: actualFacing }));
        }
      }

      const video = videoRef.current;
      if (!video) {
        throw new Error('Video element not mounted.');
      }

      video.srcObject = stream;
      await video.play();

      setCameraStatus('loading-models');

      if (!visionRef.current) {
        const engine = new VisionEngine();
        await engine.init(isGestureTrigger(settingsRef.current.trigger));
        visionRef.current = engine;
      } else if (
        isGestureTrigger(settingsRef.current.trigger) &&
        !visionRef.current.getGestureRecognizer()
      ) {
        await visionRef.current.ensureGestureRecognizer();
      }

      if (!rendererRef.current) {
        rendererRef.current = new SandevistanRenderer();
      }

      syncCanvasSize();
      smootherRef.current.reset();
      activeUiStateRef.current = false;
      setSandevistanActive(false);
      setCameraStatus('active');
      startProcessingLoop();
    } catch (err) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      setCameraError(describeCameraError(err));
      setCameraStatus('error');
    }
  }, [showToast, startProcessingLoop, syncCanvasSize]);

  return (
    <main className="relative w-full h-[100dvh] overflow-hidden bg-[#06070b]">
      {/* Non-clipped low-opacity inline video keeps mobile Chrome decoding frames at 30fps */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="fixed top-0 left-0 w-16 h-16 opacity-[0.001] pointer-events-none -z-10"
        aria-hidden="true"
      />

      {/* Full-screen camera & Sandevistan canvas */}
      <canvas
        ref={canvasRef}
        className="fixed inset-0 w-full h-full block bg-[#06070b]"
      />

      {/* Glitch label when Sandevistan is active */}
      <SandevistanBadge
        active={cameraStatus === 'active' && sandevistanActive}
      />

      {/* Top-right action controls: Stop (when active), Flip Camera, Settings */}
      <div
        className="fixed top-4 right-4 z-40 flex items-center gap-2"
        style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}
      >
        {cameraStatus === 'active' && (
          <button
            type="button"
            onClick={stopCamera}
            aria-label="Stop camera"
            className="min-h-[44px] min-w-[44px] px-3 inline-flex items-center justify-center gap-1.5 bg-[#090c14]/85 hover:bg-[#1a1020]/95 active:scale-[0.97] text-slate-300 hover:text-[#ff5ce1] border border-white/15 hover:border-[#ff2bd6]/50 backdrop-blur-md rounded-md transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff2bd6] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <VideoOff className="w-4 h-4" aria-hidden="true" />
            <span className="text-xs font-semibold tracking-wide hidden sm:inline">
              Stop
            </span>
          </button>
        )}

        <button
          type="button"
          disabled={cameraSwitching}
          onClick={handleFlipCamera}
          aria-label={
            settings.cameraFacing === 'user'
              ? 'Switch to rear camera'
              : 'Switch to front camera'
          }
          title={
            settings.cameraFacing === 'user'
              ? 'Switch to rear camera'
              : 'Switch to front camera'
          }
          className="min-h-[44px] min-w-[44px] px-3 inline-flex items-center justify-center gap-1.5 bg-[#090c14]/85 hover:bg-[#111726]/95 active:scale-[0.97] disabled:opacity-60 text-slate-100 border border-white/15 hover:border-[#00f0ff]/50 backdrop-blur-md rounded-md transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00f0ff] whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RefreshCw
            className={`w-4 h-4 text-[#00f0ff] ${cameraSwitching ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          <span className="text-xs font-semibold tracking-wide hidden sm:inline">
            {settings.cameraFacing === 'user' ? 'Front' : 'Rear'}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setSettingsOpen((prev) => !prev)}
          aria-expanded={settingsOpen}
          aria-controls="sandevistan-settings-panel"
          aria-label={settingsOpen ? 'Close settings' : 'Open settings'}
          className="min-h-[44px] min-w-[44px] px-3.5 inline-flex items-center justify-center gap-2 bg-[#090c14]/85 hover:bg-[#111726]/95 active:scale-[0.97] text-slate-100 border border-white/15 hover:border-[#00f0ff]/50 backdrop-blur-md rounded-md transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00f0ff] whitespace-nowrap shrink-0 cursor-pointer"
        >
          {settingsOpen ? (
            <>
              <X className="w-4 h-4 text-[#00f0ff]" aria-hidden="true" />
              <span className="text-xs font-semibold tracking-wide">Close</span>
            </>
          ) : (
            <>
              <SlidersHorizontal
                className="w-4 h-4 text-[#00f0ff]"
                aria-hidden="true"
              />
              <span className="text-xs font-semibold tracking-wide">
                Settings
              </span>
            </>
          )}
        </button>
      </div>

      {/* Non-blocking feedback toast */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed top-18 inset-x-4 z-50 flex justify-center"
          style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}
        >
          <div className="max-w-sm bg-[#090c14]/92 backdrop-blur-md border border-[#00f0ff]/45 text-slate-100 text-xs sm:text-sm font-medium px-3.5 py-2.5 rounded-md shadow-[0_12px_32px_rgba(0,0,0,0.7)] text-center">
            {toastMessage}
          </div>
        </div>
      )}

      {/* 30-second recording button, timer, and progress bar */}
      <RecordingHud
        ref={recordingHudRef}
        visible={cameraStatus === 'active'}
        isRecording={isRecording}
        disabled={cameraSwitching}
        onToggleRecord={() => void handleToggleRecord()}
      />

      {/* Collapsible Settings Panel */}
      <SettingsPanel
        ref={liveMeterRef}
        open={settingsOpen}
        settings={settings}
        onChange={setSettings}
        gestureModelLoading={gestureModelLoading}
        cameraActive={cameraStatus === 'active'}
        cameraSwitching={cameraSwitching}
      />

      {/* Start Camera / Loading / Permission Error Overlay */}
      <StartOverlay
        status={cameraStatus}
        error={cameraError}
        selectedTrigger={settings.trigger}
        onStartCamera={handleStartCamera}
      />

      {/* Recorded Video Preview & Export Sheet */}
      <RecordingPreviewModal
        clip={recordedClip}
        onClose={handleClosePreview}
        onNotice={showToast}
      />
    </main>
  );
}
