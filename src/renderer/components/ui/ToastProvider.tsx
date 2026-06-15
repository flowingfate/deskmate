import { toastAtom, ToastActions } from './toast.atom';
import { ToastContainer } from './Toast';

export type ToastContextType = ToastActions;

export function useToast(): ToastActions {
  const [, actions] = toastAtom.use();
  return actions;
}

export const ToastHost: React.FC = () => {
  const [toasts, { removeToast }] = toastAtom.use();
  return <ToastContainer toasts={toasts} onClose={removeToast} />;
};
