import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Square } from 'lucide-react';
import { MAX_RECORDING_MS } from '../engine/canvasRecorder';

export interface RecordingHudHandle {
  update: (elapsedMs: number, maxMs: number) => void;
}

interface RecordingHudProps {
  visible: boolean;
  isRecording: boolean;
  disabled?: boolean;
  onToggleRecord: () => void;
}

function formatSeconds(ms: number): string {
  const totalSec = Math.min(30, Math.floor(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export const RecordingHud = forwardRef<RecordingHudHandle, RecordingHudProps>(
  function RecordingHud(
    { visible, isRecording, disabled = false, onToggleRecord },
    ref
  ) {
    const timerTextRef = useRef<HTMLSpanElement | null>(null);
    const barFillRef = useRef<HTMLDivElement | null>(null);
    const topBarFillRef = useRef<HTMLDivElement | null>(null);

    useImperativeHandle(ref, () => ({
      update(elapsedMs: number, maxMs: number) {
        const clamped = Math.max(0, Math.min(maxMs, elapsedMs));
        const ratio = maxMs > 0 ? clamped / maxMs : 0;

        if (timerTextRef.current) {
          timerTextRef.current.textContent = `${formatSeconds(clamped)} / ${formatSeconds(maxMs)}`;
        }
        if (barFillRef.current) {
          barFillRef.current.style.transform = `scaleX(${ratio.toFixed(4)})`;
        }
        if (topBarFillRef.current) {
          topBarFillRef.current.style.transform = `scaleX(${ratio.toFixed(4)})`;
        }
      },
    }));

    if (!visible) return null;

    return (
      <>
        {/* Thin top-edge progress strip while recording */}
        {isRecording && (
          <div
            aria-hidden="true"
            className="pointer-events-none fixed top-0 inset-x-0 z-40 h-1 bg-white/10"
          >
            <div
              ref={topBarFillRef}
              className="h-full w-full origin-left bg-[#ff2b4a] shadow-[0_0_10px_rgba(255,43,74,0.85)] will-change-transform"
              style={{ transform: 'scaleX(0)' }}
            />
          </div>
        )}

        {/* Bottom-center thumb-zone recording controls */}
        <div
          className="pointer-events-none fixed bottom-5 inset-x-0 z-20 flex flex-col items-center gap-2.5 px-4"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          {isRecording && (
            <div
              role="status"
              aria-live="off"
              className="pointer-events-auto w-[176px] bg-[#090c14]/88 backdrop-blur-md border border-[#ff2b4a]/45 rounded-md px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.6)]"
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-[#ff5c74] uppercase">
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 rounded-full bg-[#ff2b4a] animate-pulse shadow-[0_0_8px_#ff2b4a]"
                  />
                  REC
                </span>
                <span
                  ref={timerTextRef}
                  className="font-mono tabular-nums text-xs font-semibold text-slate-100"
                >
                  {`0:00 / ${formatSeconds(MAX_RECORDING_MS)}`}
                </span>
              </div>
              <div className="h-1 w-full bg-white/12 rounded-full overflow-hidden">
                <div
                  ref={barFillRef}
                  className="h-full w-full origin-left bg-[#ff2b4a] will-change-transform"
                  style={{ transform: 'scaleX(0)' }}
                />
              </div>
            </div>
          )}

          {/* Tactile Record / Stop Shutter Button */}
          <button
            type="button"
            disabled={disabled}
            onClick={onToggleRecord}
            aria-label={isRecording ? 'Stop recording' : 'Start 30 second recording'}
            aria-pressed={isRecording}
            className={`pointer-events-auto relative h-16 w-16 rounded-full flex items-center justify-center border-2 backdrop-blur-md transition-all active:scale-95 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#00f0ff] cursor-pointer ${
              isRecording
                ? 'bg-[#1a0a12]/85 border-[#ff2b4a] shadow-[0_0_24px_rgba(255,43,74,0.45)]'
                : 'bg-[#090c14]/80 border-white/80 hover:border-[#00f0ff] shadow-[0_6px_24px_rgba(0,0,0,0.65)]'
            }`}
          >
            {isRecording ? (
              <Square
                className="w-6 h-6 fill-[#ff2b4a] text-[#ff2b4a]"
                aria-hidden="true"
              />
            ) : (
              <span
                aria-hidden="true"
                className="h-11 w-11 rounded-full bg-[#ff2b4a] shadow-[0_0_14px_rgba(255,43,74,0.6)]"
              />
            )}
          </button>
        </div>
      </>
    );
  }
);
