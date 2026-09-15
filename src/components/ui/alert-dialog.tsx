import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"
import { cn } from "cn"

function AlertDialog(props: AlertDialogPrimitive.Root.Props) { return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} /> }
function AlertDialogContent({ className, ...props }: AlertDialogPrimitive.Popup.Props) {
  return <AlertDialogPrimitive.Portal><AlertDialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-ink-950/75 backdrop-blur-sm" /><AlertDialogPrimitive.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-6"><AlertDialogPrimitive.Popup data-slot="alert-dialog-content" className={cn("w-full max-w-md rounded-panel border border-border bg-surface-raised p-5 text-text shadow-2xl outline-none", className)} {...props} /></AlertDialogPrimitive.Viewport></AlertDialogPrimitive.Portal>
}
function AlertDialogTitle(props: AlertDialogPrimitive.Title.Props) { return <AlertDialogPrimitive.Title data-slot="alert-dialog-title" className="font-sans text-heading font-semibold" {...props} /> }
function AlertDialogDescription(props: AlertDialogPrimitive.Description.Props) { return <AlertDialogPrimitive.Description data-slot="alert-dialog-description" className="mt-2 text-body text-text-muted" {...props} /> }

export { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle }
