import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cn } from "cn"

function Dialog(props: DialogPrimitive.Root.Props) { return <DialogPrimitive.Root data-slot="dialog" {...props} /> }
function DialogContent({ className, ...props }: DialogPrimitive.Popup.Props) {
  return <DialogPrimitive.Portal><DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-ink-950/75 backdrop-blur-sm" /><DialogPrimitive.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-6"><DialogPrimitive.Popup data-slot="dialog-content" className={cn("w-full max-w-md rounded-panel border border-border bg-surface-raised p-5 text-text shadow-2xl outline-none", className)} {...props} /></DialogPrimitive.Viewport></DialogPrimitive.Portal>
}
function DialogTitle(props: DialogPrimitive.Title.Props) { return <DialogPrimitive.Title data-slot="dialog-title" className="font-sans text-heading font-semibold" {...props} /> }
function DialogDescription(props: DialogPrimitive.Description.Props) { return <DialogPrimitive.Description data-slot="dialog-description" className="mt-2 text-body text-text-muted" {...props} /> }

export { Dialog, DialogContent, DialogDescription, DialogTitle }
