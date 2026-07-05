// src/renderer/components/autoUpdate/RestartingOverlay.tsx
// Full-screen restart prompt component - similar to OS restart effect
import React from 'react';
import { RefreshCw } from 'lucide-react';

export interface RestartingOverlayProps {
  isVisible: boolean;
  message?: string;
}

export const RestartingOverlay: React.FC<RestartingOverlayProps> = ({
  isVisible,
  message = 'Restarting'
}) => {
  if (!isVisible) {
    return null;
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center w-screen h-screen bg-[linear-gradient(135deg,#171717_0%,#262626_50%,#171717_100%)] z-99999 animate-[fadeIn_0.3s_ease-out]">
      <div className="flex flex-col items-center gap-8 animate-[contentFadeIn_0.5s_ease-out_0.2s_both]">
        {/* Spinning refresh icon */}
        <div className="w-20 h-20 flex items-center justify-center">
          <RefreshCw className="w-16 h-16 text-neutral-500 animate-[spin_2s_linear_infinite] drop-shadow-[0_0_20px_rgba(0,0,0,0.5)]" />
        </div>

        {/* Restart message text */}
        <div className="text-2xl font-medium text-[#e9e9e9] tracking-[0.5px] [text-shadow:0_2px_10px_rgba(0,0,0,0.3)]">
          {message}
        </div>

        {/* Progress dots animation */}
        <div className="flex gap-2 mt-2">
          <span className="w-2 h-2 rounded-full bg-neutral-500 animate-[dotPulse_1.4s_ease-in-out_infinite]"></span>
          <span className="w-2 h-2 rounded-full bg-neutral-500 animate-[dotPulse_1.4s_ease-in-out_infinite] [animation-delay:0.2s]"></span>
          <span className="w-2 h-2 rounded-full bg-neutral-500 animate-[dotPulse_1.4s_ease-in-out_infinite] [animation-delay:0.4s]"></span>
        </div>
      </div>
    </div>
  );
};

export default RestartingOverlay;