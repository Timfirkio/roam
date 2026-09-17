import { Toast } from '@base-ui/react/toast'
import { CheckCircle, CircleNotch, WarningCircle, X } from '@phosphor-icons/react'
import { cn } from 'cn'

type ToastKind = 'loading' | 'success' | 'error'

export const toastManager = Toast.createToastManager<{ kind?: ToastKind }>()

function ToastViewport() {
  const { close, toasts } = Toast.useToastManager<{ kind?: ToastKind }>()

  return <Toast.Portal><Toast.Viewport className="pointer-events-none fixed inset-x-4 bottom-[calc(76px+1rem+var(--roam-safe-bottom))] z-50 mx-auto flex max-w-md flex-col gap-3 outline-none sm:right-6 sm:left-auto">
    {toasts.map(toast => {
      const kind = toast.data?.kind ?? 'success'
      const Icon = kind === 'loading' ? CircleNotch : kind === 'error' ? WarningCircle : CheckCircle
      return <Toast.Root key={toast.id} toast={toast} className="pointer-events-auto"><Toast.Content className={cn('flex items-start gap-3 rounded-panel border bg-surface-raised p-4 text-text shadow-2xl', kind === 'error' ? 'border-danger-500' : 'border-border-strong')}>
        <Icon className={cn('mt-0.5 size-5 shrink-0', kind === 'loading' && 'animate-spin', kind === 'error' ? 'text-danger-500' : 'text-accent')} aria-hidden="true" />
        <div className="min-w-0 flex-1"><Toast.Title className="font-sans text-body font-semibold">{toast.title}</Toast.Title>{toast.description && <Toast.Description className="mt-1 text-body text-text-muted">{toast.description}</Toast.Description>}</div>
        {kind !== 'loading' && <Toast.Close onClick={() => close(toast.id)} className="-m-1 flex size-control-compact shrink-0 items-center justify-center rounded-control text-text-muted hover:bg-surface-interactive hover:text-text focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus" aria-label="Dismiss notification"><X className="size-4" aria-hidden="true" /></Toast.Close>}
      </Toast.Content></Toast.Root>
    })}
  </Toast.Viewport></Toast.Portal>
}

function Toaster() {
  return <Toast.Provider toastManager={toastManager} timeout={5_000} limit={3}><ToastViewport /></Toast.Provider>
}

export { Toaster }
