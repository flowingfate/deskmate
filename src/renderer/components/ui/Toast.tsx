import React, { useEffect, useState, useRef } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { Button } from '@/shadcn/button';

export interface ToastMessage {
  id: string;
  message: string | React.ReactNode;
  type: 'success' | 'error' | 'warning' | 'info' | 'update';
  duration?: number;
  persistent?: boolean; // Whether to display persistently, don't auto-dismiss
  onDismiss?: () => void;
  actions?: Array<{ label: string; onClick: () => void }>;
}

interface ToastItemProps {
  toast: ToastMessage;
  onClose: (id: string) => void;
  index: number;
}

const ToastItem: React.FC<ToastItemProps> = ({ toast, onClose, index }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [progress, setProgress] = useState(100);
  const closeRef = useRef<NodeJS.Timeout>();

  const handleClose = () => {
    if (isClosing) return;

    setIsClosing(true);

    closeRef.current = setTimeout(() => {
      toast.onDismiss?.();
      onClose(toast.id);
    }, 200); // Wait for exit animation to complete
  };

  useEffect(() => {
    // Enter animation
    const showTimer = setTimeout(() => setIsVisible(true), 10);

    // If it's a persistent toast, don't set auto-dismiss
    if (toast.persistent) {
      return () => {
        clearTimeout(showTimer);
        clearTimeout(closeRef.current);
      };
    }

    // All non-persistent toasts auto-dismiss after 2 seconds
    const duration = toast.duration || 2000;

    // Kick off the progress countdown once the enter animation settles
    const progressTimer = setTimeout(() => setProgress(0), 30);

    // Auto-dismiss after duration
    const autoCloseTimer = setTimeout(() => {
      handleClose();
    }, duration);

    return () => {
      clearTimeout(showTimer);
      clearTimeout(progressTimer);
      clearTimeout(autoCloseTimer);
      clearTimeout(closeRef.current);
    };
  }, [toast]);

  const getTypeStyles = (type: ToastMessage['type']) => {
    switch (type) {
      case 'success':
        return { icon: CheckCircle, iconColor: 'text-green-600', iconBg: 'bg-green-100', accent: 'bg-green-500' };
      case 'error':
        return { icon: AlertCircle, iconColor: 'text-red-600', iconBg: 'bg-red-100', accent: 'bg-red-500' };
      case 'warning':
        return { icon: AlertTriangle, iconColor: 'text-amber-600', iconBg: 'bg-amber-100', accent: 'bg-amber-500' };
      case 'info':
        return { icon: Info, iconColor: 'text-blue-600', iconBg: 'bg-blue-100', accent: 'bg-blue-500' };
      case 'update':
      default:
        return { icon: Info, iconColor: 'text-neutral-600', iconBg: 'bg-neutral-100', accent: 'bg-neutral-400' };
    }
  };

  const styles = getTypeStyles(toast.type);
  const Icon = styles.icon;
  const duration = toast.duration || 2000;

  return (
    <div
      role="status"
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
      className={`
        group relative overflow-hidden
        bg-white/95 backdrop-blur-md
        border border-neutral-200/80
        rounded-xl shadow-lg shadow-black/[0.06]
        transform transition-all duration-300 ease-out
        ${isVisible && !isClosing
          ? 'translate-x-0 opacity-100 scale-100'
          : 'translate-x-full opacity-0 scale-95'
        }
      `}
      style={{
        marginTop: index * 8, // Stack offset
        zIndex: 1000 - index, // Later ones on top
        width: 'min(24rem, calc(100vw - 2rem))',
        maxHeight: 'min(70vh, calc(100vh - 2rem))'
      }}
    >
      <div className="flex flex-col gap-2.5 p-3.5">
        {/* Top content area */}
        <div className="flex items-start gap-3 min-w-0">
          {/* Icon chip */}
          <div className={`${styles.iconBg} ${styles.iconColor} shrink-0 flex items-center justify-center w-7 h-7 rounded-lg`}>
            <Icon size={16} strokeWidth={2.25} />
          </div>

          {/* Message content */}
          <div className="flex-1 min-w-0 max-h-[42vh] overflow-y-auto pt-0.5 text-[13px] font-medium leading-relaxed text-neutral-700 whitespace-pre-line wrap-anywhere">
            {toast.message}
          </div>

          {/* Close button */}
          <button
            type="button"
            onClick={handleClose}
            className="shrink-0 -mt-0.5 -mr-0.5 flex items-center justify-center w-6 h-6 rounded-md text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors"
            aria-label="Close notification"
          >
            <X size={14} />
          </button>
        </div>

        {/* Action buttons area */}
        {toast.actions && toast.actions.length > 0 && (
          <div className="flex flex-wrap items-center justify-end gap-2 pl-10">
            {toast.actions.map((action, actionIndex) => (
              <Button
                key={actionIndex}
                size="sm"
                variant={actionIndex === toast.actions!.length - 1 ? 'default' : 'ghost'}
                className="h-7 px-3 text-xs"
                onClick={() => {
                  action.onClick();
                  // Always close toast when clicking action button
                  handleClose();
                }}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* Auto-dismiss progress bar */}
      {!toast.persistent && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-neutral-100">
          <div
            className={`h-full ${styles.accent} transition-[width] ease-linear`}
            style={{ width: `${progress}%`, transitionDuration: `${duration}ms` }}
          />
        </div>
      )}
    </div>
  );
};

interface ToastContainerProps {
  toasts: ToastMessage[];
  onClose: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onClose }) => {
  return (
    <div className="fixed top-4 right-4 left-4 sm:left-auto z-9999 pointer-events-none flex flex-col items-end max-h-[calc(100vh-2rem)]">
      <div className="space-y-2 pointer-events-auto overflow-y-auto max-h-[calc(100vh-2rem)] pr-1">
        {toasts.map((toast, index) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onClose={onClose}
            index={index}
          />
        ))}
      </div>
    </div>
  );
};