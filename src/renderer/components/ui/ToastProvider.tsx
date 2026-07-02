import { toastAtom, ToastActions } from './toast.atom';
import { ToastContainer } from './Toast';

export type ToastContextType = ToastActions;

export function useToast(): ToastActions {
  return toastAtom.useChange();
}

export const ToastHost: React.FC = () => {
  const [toasts, { removeToast }] = toastAtom.use();
  return <ToastContainer toasts={toasts} onClose={removeToast} />;
};
