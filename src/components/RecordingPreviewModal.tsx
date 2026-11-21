import { useEffect, useMemo, useState } from 'react';
import { Download, Info, Share2, Trash2, X } from 'lucide-react';
import type { RecordedClip } from '../types/sandevistan';
import { canShareFile } from '../engine/canvasRecorder';

interface RecordingPreviewModalProps {
  clip: RecordedClip | null;
  onClose: () => void;
  onNotice?: (message: string) => void;
}

function formatDuration(ms: number): string {
  const sec = Math.max(1, Math.round(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function RecordingPreviewModal({
  clip,
  onClose,
  onNotice,
}: RecordingPreviewModalProps) {
  const [sharing, setSharing] = useState(false);

  const shareSupported = useMemo(() => {
    if (!clip) return false;
    return canShareFile(clip);
  }, [clip]);

  useEffect(() => {
    if (!clip) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clip, onClose]);

  if (!clip) return null;

  const handleSave = () => {
    const downloadUrl = URL.createObjectURL(clip.blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = clip.filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Revoke temporary download Blob URL after browser initiates download
    window.setTimeout(() => {
      URL.revokeObjectURL(downloadUrl);
    }, 1000);

    onNotice?.(`Saved ${clip.filename}`);
  };

  const handleShare = async () => {
    if (!shareSupported || sharing) return;
    setSharing(true);
    try {
      const file = new File([clip.blob], clip.filename, {
        type:
          clip.mimeType ||
          (clip.extension === 'mp4' ? 'video/mp4' : 'video/webm'),
      });
      await navigator.share({
        files: [file],
        title: 'Sandevistan Cam',
      });
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      if (name !== 'AbortError') {
        onNotice?.('Could not open share sheet. Use Save to download instead.');
      }
    } finally {
      setSharing(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="recording-preview-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#06070b]/92 backdrop-blur-md"
      style={{
        paddingTop: 'max(1rem, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))',
      }}
    >
      <div className="w-full max-w-lg max-h-[92dvh] flex flex-col bg-[#090c14] border border-white/15 rounded-lg shadow-[0_24px_64px_rgba(0,0,0,0.85)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-white/10">
          <div className="min-w-0">
            <h2
              id="recording-preview-title"
              className="font-display text-xl font-bold tracking-wider text-slate-100 leading-tight"
            >
              Recording Preview
            </h2>
            <p className="mt-0.5 text-xs text-slate-400 font-mono tabular-nums truncate">
              <span>{formatDuration(clip.durationMs)}</span>
              <span aria-hidden="true"> · </span>
              <span>{formatSize(clip.blob.size)}</span>
              <span aria-hidden="true"> · </span>
              <span>{clip.extension.toUpperCase()}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-slate-400 hover:text-slate-100 rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-[#00f0ff] cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Video playback area */}
        <div className="flex-1 min-h-0 p-4 flex flex-col gap-3 overflow-y-auto">
          <div className="relative w-full bg-black rounded-md overflow-hidden border border-white/10 flex items-center justify-center">
            <video
              src={clip.url}
              controls
              playsInline
              autoPlay
              loop
              className="w-full max-h-[52dvh] object-contain bg-black"
            />
          </div>

          {clip.isWebmFallback && (
            <div className="flex items-start gap-2.5 bg-[#150d1c] border border-[#ff2bd6]/40 rounded-md px-3 py-2.5 text-xs text-slate-200 leading-relaxed">
              <Info
                className="w-4 h-4 text-[#ff5ce1] shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <span>
                Your browser does not support direct MP4 recording, so this clip
                was recorded as WebM ({clip.filename}).
              </span>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="px-4 py-3.5 border-t border-white/10 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleSave}
            className="cyber-chamfer flex-1 min-w-[110px] min-h-[46px] px-4 py-2.5 inline-flex items-center justify-center gap-2 bg-[#00f0ff] hover:bg-[#3bf4ff] active:scale-[0.98] text-[#06070b] font-semibold text-sm transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00f0ff] whitespace-nowrap cursor-pointer"
          >
            <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Save</span>
          </button>

          {shareSupported && (
            <button
              type="button"
              disabled={sharing}
              onClick={handleShare}
              className="flex-1 min-w-[110px] min-h-[46px] px-4 py-2.5 inline-flex items-center justify-center gap-2 bg-[#111827] hover:bg-[#1a2438] active:scale-[0.98] disabled:opacity-60 text-slate-100 border border-[#00f0ff]/45 font-semibold text-sm rounded-md transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00f0ff] whitespace-nowrap cursor-pointer"
            >
              <Share2 className="w-4 h-4 text-[#00f0ff] shrink-0" aria-hidden="true" />
              <span>{sharing ? 'Sharing...' : 'Share'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="min-h-[46px] px-4 py-2.5 inline-flex items-center justify-center gap-2 bg-transparent hover:bg-[#1e1020] active:scale-[0.98] text-slate-300 hover:text-[#ff5ce1] border border-white/15 hover:border-[#ff2bd6]/50 font-medium text-sm rounded-md transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff2bd6] whitespace-nowrap cursor-pointer"
          >
            <Trash2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Discard</span>
          </button>
        </div>
      </div>
    </div>
  );
}
