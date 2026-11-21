import { useCallback, useEffect, useRef, useState } from 'react';
import { VideoOff } from 'lucide-react';
import { VisionEngine } from './engine/mediapipe';
import { SandevistanRenderer } from './engine/sandevistanRenderer';
import {
  TriggerSmoother,
  evaluateFaceTrigger,
  evaluateGestureTrigger,
} from './engine/triggerEvaluator';
import { SandevistanBadge } from './components/SandevistanBadge';
import {
  SettingsPanel,
  type LiveMeterHandle,
} from './components/SettingsPanel';
import { StartOverlay } from './components/StartOverlay';
import type {
  CameraErrorInfo,
  CameraStatus,
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
        'Access to the front camera was blocked. Allow camera permission to run the Sandevistan effect.',
      hint: 'In Chrome, tap the lock or tune icon next to the address bar, set Camera to Allow, then tap Try Again.',
    };
  }

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return {
      title: 'No camera detected',
      message: 'We could not find a front-facing camera on this device.',
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

async function acquireFrontCameraStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Camera API is unavailable in this browser context.');
  }

  // Primary: front camera at reduced 640x480 resolution & 30fps for mobile performance
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'user' },
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30, max: 30 },
      },
      audio: false,
    });
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
      return await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
    }
    throw err;
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

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveMeterRef = useRef<LiveMeterHandle | null>(null);

  const settingsRef = useRef<SandevistanSettings>(settings);
  const streamRef = useRef<MediaStream | null>(null);
  const visionRef = useRef<VisionEngine | null>(null);
  const rendererRef = useRef<SandevistanRenderer | null>(null);
  const smootherRef = useRef<TriggerSmoother>(new TriggerSmoother(3, 10));
  const rafIdRef = useRef<number | null>(null);
  const activeUiStateRef = useRef(false);

  // Sync settings ref + persist to localStorage
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
  }, [settings]);

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

  const stopCamera = useCallback(() => {
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
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
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

      renderer.syncProcessingResolution(video.videoWidth, video.videoHeight);
      renderer.captureMirroredFrame(video);

      // MediaPipe requires strictly monotonically increasing timestamps (in ms)
      const ts = Math.max(Math.round(now), lastMediaPipeTs + 1);
      lastMediaPipeTs = ts;

      const currentSettings = settingsRef.current;
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
      const stream = await acquireFrontCameraStream();
      streamRef.current = stream;

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
  }, [startProcessingLoop, syncCanvasSize]);

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

      {/* Full-screen mirrored camera & Sandevistan canvas */}
      <canvas
        ref={canvasRef}
        className="fixed inset-0 w-full h-full block bg-[#06070b]"
      />

      {/* Glitch label when Sandevistan is active */}
      <SandevistanBadge active={cameraStatus === 'active' && sandevistanActive} />

      {/* Stop camera button positioned left of the Settings toggle so it never overlaps mobile drawer */}
      {cameraStatus === 'active' && (
        <button
          type="button"
          onClick={stopCamera}
          aria-label="Stop camera"
          className="fixed top-4 right-[118px] z-40 min-h-[44px] min-w-[44px] px-3 inline-flex items-center justify-center gap-1.5 bg-[#090c14]/85 hover:bg-[#1a1020]/95 active:scale-[0.97] text-slate-300 hover:text-[#ff5ce1] border border-white/15 hover:border-[#ff2bd6]/50 backdrop-blur-md rounded-md transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff2bd6] whitespace-nowrap shrink-0 cursor-pointer"
          style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}
        >
          <VideoOff className="w-4 h-4" aria-hidden="true" />
          <span className="text-xs font-semibold tracking-wide hidden sm:inline">
            Stop
          </span>
        </button>
      )}

      {/* Collapsible Settings Panel */}
      <SettingsPanel
        ref={liveMeterRef}
        open={settingsOpen}
        onToggleOpen={() => setSettingsOpen((prev) => !prev)}
        settings={settings}
        onChange={setSettings}
        gestureModelLoading={gestureModelLoading}
        cameraActive={cameraStatus === 'active'}
      />

      {/* Start Camera / Loading / Permission Error Overlay */}
      <StartOverlay
        status={cameraStatus}
        error={cameraError}
        selectedTrigger={settings.trigger}
        onStartCamera={handleStartCamera}
      />
    </main>
  );
}
