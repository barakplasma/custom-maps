// One shared <wa-toast> stack for the whole app.
import type WaToast from '@awesome.me/webawesome/dist/components/toast/toast.js';

type ToastVariant = 'brand' | 'success' | 'warning' | 'danger' | 'neutral';

function toastStack(): WaToast {
  let el = document.querySelector('wa-toast');
  if (!el) {
    el = document.createElement('wa-toast');
    el.placement = 'bottom-center';
    document.body.appendChild(el);
  }
  return el;
}

export function showToast(message: string, variant: ToastVariant = 'danger'): void {
  const icon = variant === 'danger' ? 'circle-alert' : variant === 'success' ? 'check' : undefined;
  void toastStack().create(message, { variant, duration: 5000, icon });
}
