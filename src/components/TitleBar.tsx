import React from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { X, Minus, Square } from 'lucide-react';
import { usePlayerStore } from '../store/playerStore';

export default function TitleBar() {
  const win = getCurrentWindow();
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const isPlaying = usePlayerStore(s => s.isPlaying);

  return (
    <div className="titlebar" data-tauri-drag-region>
      <span className="titlebar-title" data-tauri-drag-region>Psysonic</span>

      <div className="titlebar-track" data-tauri-drag-region>
        {currentTrack && (
          <>
            <span className="titlebar-track-state">{isPlaying ? '▶' : '⏸'}</span>
            <span className="titlebar-track-text truncate">
              {currentTrack.artist && `${currentTrack.artist} – `}{currentTrack.title}
            </span>
          </>
        )}
      </div>

      <div className="titlebar-controls">
        <button
          className="titlebar-btn titlebar-btn-minimize"
          onClick={() => win.minimize()}
          data-tooltip="Minimize"
          data-tooltip-pos="bottom"
        >
          <Minus size={10} />
        </button>
        <button
          className="titlebar-btn titlebar-btn-maximize"
          onClick={() => win.toggleMaximize()}
          data-tooltip="Maximize"
          data-tooltip-pos="bottom"
        >
          <Square size={9} />
        </button>
        <button
          className="titlebar-btn titlebar-btn-close"
          onClick={() => win.close()}
          data-tooltip="Close"
          data-tooltip-pos="bottom"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
