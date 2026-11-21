import { forwardRef, useImperativeHandle, useRef } from 'react';
import { ChevronDown, RotateCcw } from 'lucide-react';
import type {
  CameraFacing,
  SandevistanSettings,
  TriggerId,
} from '../types/sandevistan';
import {
  DEFAULT_SETTINGS,
  TRIGGER_OPTIONS,
  getTriggerOption,
} from '../utils/settings';

export interface LiveMeterHandle {
  update: (value: number, threshold: number, isActive: boolean) => void;
}

interface SettingsPanelProps {
  open: boolean;
  settings: SandevistanSettings;
  onChange: (next: SandevistanSettings) => void;
  gestureModelLoading: boolean;
  cameraActive: boolean;
  cameraSwitching: boolean;
}

const FACE_TRIGGERS = TRIGGER_OPTIONS.filter((t) => t.category === 'face');
const GESTURE_TRIGGERS = TRIGGER_OPTIONS.filter((t) => t.category === 'gesture');

export const SettingsPanel = forwardRef<LiveMeterHandle, SettingsPanelProps>(
  function SettingsPanel(
    {
      open,
      settings,
      onChange,
      gestureModelLoading,
      cameraActive,
      cameraSwitching,
    },
    ref
  ) {
    const barFillRef = useRef<HTMLDivElement | null>(null);
    const valueTextRef = useRef<HTMLSpanElement | null>(null);

    useImperativeHandle(ref, () => ({
      update(value: number, threshold: number, isActive: boolean) {
        const clamped = Math.max(0, Math.min(1, value));
        const pct = (clamped * 100).toFixed(1);
        const over = clamped >= threshold;

        if (barFillRef.current) {
          barFillRef.current.style.transform = `scaleX(${clamped.toFixed(4)})`;
          barFillRef.current.style.backgroundColor = isActive
            ? '#ff2bd6'
            : over
              ? '#fcee09'
              : '#00f0ff';
        }
        if (valueTextRef.current) {
          valueTextRef.current.textContent = `${pct}%`;
          valueTextRef.current.style.color = isActive
            ? '#ff2bd6'
            : over
              ? '#fcee09'
              : '#00f0ff';
        }
      },
    }));

    if (!open) return null;

    const selectedOption = getTriggerOption(settings.trigger);

    const updateField = <K extends keyof SandevistanSettings>(
      key: K,
      value: SandevistanSettings[K]
    ) => {
      onChange({ ...settings, [key]: value });
    };

    const handleCameraSelect = (facing: CameraFacing) => {
      if (facing === settings.cameraFacing || cameraSwitching) return;
      updateField('cameraFacing', facing);
    };

    const handleReset = () => {
      onChange({ ...DEFAULT_SETTINGS });
    };

    return (
      <aside
        id="sandevistan-settings-panel"
        aria-label="Sandevistan settings"
        className="fixed z-30 inset-x-3 bottom-3 sm:inset-x-auto sm:right-4 sm:top-18 sm:bottom-auto sm:w-[340px] max-h-[74dvh] overflow-y-auto bg-[#090c14]/92 backdrop-blur-lg border border-white/15 rounded-lg p-4 shadow-[0_18px_48px_rgba(0,0,0,0.75)]"
        style={{
          marginBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-white/10">
          <h2 className="font-display text-lg font-bold tracking-wider text-slate-100">
            Controls
          </h2>
          <button
            type="button"
            onClick={handleReset}
            className="min-h-[36px] px-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-[#00f0ff] transition-colors rounded focus-visible:outline-2 focus-visible:outline-[#00f0ff] whitespace-nowrap cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Reset</span>
          </button>
        </div>

        <div className="space-y-4">
          {/* Camera Front / Rear Selector */}
          <div>
            <span
              id="camera-facing-label"
              className="block text-xs font-semibold text-slate-200 mb-1.5"
            >
              Camera
            </span>
            <div
              role="group"
              aria-labelledby="camera-facing-label"
              className="grid grid-cols-2 gap-1.5 p-1 bg-[#0f1420] border border-white/15 rounded-md"
            >
              <button
                type="button"
                disabled={cameraSwitching}
                onClick={() => handleCameraSelect('user')}
                aria-pressed={settings.cameraFacing === 'user'}
                className={`min-h-[40px] px-3 text-xs font-semibold rounded transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-[#00f0ff] ${
                  settings.cameraFacing === 'user'
                    ? 'bg-[#00f0ff]/20 text-[#00f0ff] border border-[#00f0ff]/55'
                    : 'text-slate-300 hover:text-slate-100 border border-transparent'
                }`}
              >
                Front
              </button>
              <button
                type="button"
                disabled={cameraSwitching}
                onClick={() => handleCameraSelect('environment')}
                aria-pressed={settings.cameraFacing === 'environment'}
                className={`min-h-[40px] px-3 text-xs font-semibold rounded transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-[#00f0ff] ${
                  settings.cameraFacing === 'environment'
                    ? 'bg-[#00f0ff]/20 text-[#00f0ff] border border-[#00f0ff]/55'
                    : 'text-slate-300 hover:text-slate-100 border border-transparent'
                }`}
              >
                Rear
              </button>
            </div>
          </div>

          {/* Trigger Dropdown */}
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <label
                htmlFor="trigger-select"
                className="text-xs font-semibold text-slate-200"
              >
                Trigger
              </label>
              <span className="text-[11px] text-slate-400">
                {selectedOption.description}
              </span>
            </div>

            <div className="relative">
              <select
                id="trigger-select"
                value={settings.trigger}
                onChange={(e) =>
                  updateField('trigger', e.target.value as TriggerId)
                }
                className="w-full min-h-[44px] appearance-none bg-[#0f1420] hover:bg-[#141b2b] text-sm font-medium text-slate-100 border border-white/15 focus:border-[#00f0ff] rounded-md pl-3.5 pr-10 py-2 outline-none transition-colors cursor-pointer"
              >
                <optgroup label="Face expressions" className="bg-[#0f1420]">
                  {FACE_TRIGGERS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Hand gestures" className="bg-[#0f1420]">
                  {GESTURE_TRIGGERS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </optgroup>
              </select>
              <ChevronDown
                className="pointer-events-none w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
            </div>

            {gestureModelLoading && (
              <p className="mt-1.5 text-[11px] text-[#00f0ff]">
                Loading hand gesture model...
              </p>
            )}
          </div>

          {/* Live Value Bar */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-medium text-slate-300">
                Live trigger level
              </span>
              <span
                ref={valueTextRef}
                className="font-mono tabular-nums font-semibold text-[#00f0ff]"
              >
                {cameraActive ? '0.0%' : '—'}
              </span>
            </div>
            <div className="relative h-2.5 w-full bg-white/10 rounded-sm overflow-hidden">
              <div
                ref={barFillRef}
                className="h-full w-full origin-left bg-[#00f0ff] transition-colors duration-100 will-change-transform"
                style={{ transform: 'scaleX(0)' }}
              />
              {/* Threshold marker line */}
              <div
                aria-hidden="true"
                className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)] pointer-events-none"
                style={{ left: `${settings.threshold * 100}%` }}
              />
            </div>
          </div>

          {/* Threshold Slider */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <label
                htmlFor="threshold-slider"
                className="font-medium text-slate-300"
              >
                Threshold
              </label>
              <span className="font-mono tabular-nums text-slate-200">
                {settings.threshold.toFixed(2)}
              </span>
            </div>
            <input
              id="threshold-slider"
              type="range"
              min={0.1}
              max={0.95}
              step={0.05}
              value={settings.threshold}
              onChange={(e) =>
                updateField('threshold', parseFloat(e.target.value))
              }
              className="cyber-slider"
            />
          </div>

          <div className="h-px bg-white/10" />

          {/* Trail Length Slider */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <label
                htmlFor="trail-length-slider"
                className="font-medium text-slate-300"
              >
                Trail length
              </label>
              <span className="font-mono tabular-nums text-slate-200">
                {settings.trailLength} frames
              </span>
            </div>
            <input
              id="trail-length-slider"
              type="range"
              min={4}
              max={20}
              step={1}
              value={settings.trailLength}
              onChange={(e) =>
                updateField('trailLength', parseInt(e.target.value, 10))
              }
              className="cyber-slider"
            />
          </div>

          {/* Trail Spacing Slider */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <label
                htmlFor="trail-spacing-slider"
                className="font-medium text-slate-300"
              >
                Trail spacing
              </label>
              <span className="font-mono tabular-nums text-slate-200">
                {settings.trailSpacing} px
              </span>
            </div>
            <input
              id="trail-spacing-slider"
              type="range"
              min={2}
              max={36}
              step={1}
              value={settings.trailSpacing}
              onChange={(e) =>
                updateField('trailSpacing', parseInt(e.target.value, 10))
              }
              className="cyber-slider"
            />
          </div>

          {/* Glow Toggle */}
          <div className="flex items-center justify-between pt-1">
            <span
              id="glow-toggle-label"
              className="text-xs font-medium text-slate-200"
            >
              Neon glow
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.glowEnabled}
              aria-labelledby="glow-toggle-label"
              onClick={() => updateField('glowEnabled', !settings.glowEnabled)}
              className="min-h-[44px] min-w-[56px] inline-flex items-center justify-end cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00f0ff] rounded"
            >
              <span
                className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors ${
                  settings.glowEnabled
                    ? 'bg-[#00f0ff]/25 border-[#00f0ff]'
                    : 'bg-white/10 border-white/20'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full transition-transform ${
                    settings.glowEnabled
                      ? 'translate-x-5.5 bg-[#00f0ff] shadow-[0_0_8px_#00f0ff]'
                      : 'translate-x-1 bg-slate-400'
                  }`}
                />
              </span>
            </button>
          </div>

          {/* Record Microphone Audio Toggle */}
          <div className="flex items-center justify-between">
            <span
              id="record-audio-label"
              className="text-xs font-medium text-slate-200"
            >
              Record microphone audio
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.recordAudio}
              aria-labelledby="record-audio-label"
              onClick={() => updateField('recordAudio', !settings.recordAudio)}
              className="min-h-[44px] min-w-[56px] inline-flex items-center justify-end cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00f0ff] rounded"
            >
              <span
                className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors ${
                  settings.recordAudio
                    ? 'bg-[#00f0ff]/25 border-[#00f0ff]'
                    : 'bg-white/10 border-white/20'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full transition-transform ${
                    settings.recordAudio
                      ? 'translate-x-5.5 bg-[#00f0ff] shadow-[0_0_8px_#00f0ff]'
                      : 'translate-x-1 bg-slate-400'
                  }`}
                />
              </span>
            </button>
          </div>
        </div>
      </aside>
    );
  }
);
