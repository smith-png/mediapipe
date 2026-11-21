import { AlertTriangle, Camera, Loader2 } from 'lucide-react';
import type { CameraErrorInfo, CameraStatus } from '../types/sandevistan';
import { getTriggerOption } from '../utils/settings';
import type { TriggerId } from '../types/sandevistan';

interface StartOverlayProps {
  status: CameraStatus;
  error: CameraErrorInfo | null;
  selectedTrigger: TriggerId;
  onStartCamera: () => void;
}

export function StartOverlay({
  status,
  error,
  selectedTrigger,
  onStartCamera,
}: StartOverlayProps) {
  if (status === 'active') return null;

  const isLoading = status === 'requesting' || status === 'loading-models';
  const triggerInfo = getTriggerOption(selectedTrigger);

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center p-6 bg-[#06070b]">
      {/* Subtle dark cyberpunk atmospheric glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[540px] h-[280px] rounded-full bg-[#00f0ff]/10 blur-[110px]" />
        <div className="absolute -bottom-32 left-1/2 -translate-x-1/2 w-[480px] h-[240px] rounded-full bg-[#ff2bd6]/10 blur-[110px]" />
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }}
        />
      </div>

      <div className="relative w-full max-w-md text-center space-y-6">
        <div className="space-y-2.5">
          <h1 className="font-display text-5xl sm:text-6xl font-bold tracking-[0.08em] text-slate-50 [text-wrap:balance]">
            SANDEVISTAN
          </h1>
          <p className="text-sm sm:text-[15px] text-slate-400 leading-relaxed max-w-sm mx-auto">
            Real-time webcam afterimage trails running locally in your browser.
            Current trigger:{' '}
            <span className="text-slate-200 font-medium">
              {triggerInfo.label}
            </span>
            .
          </p>
        </div>

        {status === 'error' && error ? (
          <div
            role="alert"
            className="text-left bg-[#120b14]/90 border border-[#ff2bd6]/45 rounded-lg p-4 space-y-2"
          >
            <div className="flex items-center gap-2 text-[#ff5ce1]">
              <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <h2 className="text-sm font-semibold">{error.title}</h2>
            </div>
            <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">
              {error.message}
            </p>
            <p className="text-xs text-slate-400 leading-relaxed">
              {error.hint}
            </p>
          </div>
        ) : null}

        <div className="pt-1 flex flex-col items-center gap-3">
          <button
            type="button"
            disabled={isLoading}
            onClick={onStartCamera}
            className="cyber-chamfer min-h-[48px] px-8 py-3 inline-flex items-center justify-center gap-2.5 bg-[#00f0ff] hover:bg-[#3bf4ff] active:scale-[0.98] disabled:opacity-70 disabled:cursor-wait text-[#06070b] font-semibold text-sm tracking-wide transition-all shadow-[0_0_28px_rgba(0,240,255,0.35)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#00f0ff] whitespace-nowrap cursor-pointer"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>
                  {status === 'requesting'
                    ? 'Requesting camera...'
                    : 'Loading vision models...'}
                </span>
              </>
            ) : (
              <>
                <Camera className="w-4 h-4" aria-hidden="true" />
                <span>
                  {status === 'error' ? 'Try Again' : 'Start Camera'}
                </span>
              </>
            )}
          </button>

          <p className="text-xs text-slate-500">
            Processed on-device · No video leaves your browser
          </p>
        </div>
      </div>
    </div>
  );
}
