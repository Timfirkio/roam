import * as React from "react"
import { Menu } from "@base-ui/react/menu"
import { cn } from "cn"

function DropdownMenu(props: Menu.Root.Props) {
  return <Menu.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuTrigger(props: Menu.Trigger.Props) {
  return <Menu.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({ className, sideOffset = 8, side, align, ...props }: Menu.Popup.Props & Pick<Menu.Positioner.Props, "side" | "align" | "sideOffset">) {
  return <Menu.Portal><Menu.Positioner sideOffset={sideOffset} side={side} align={align}><Menu.Popup data-slot="dropdown-menu-content" className={cn("z-50 min-w-44 rounded-control border border-border bg-surface-raised p-1 text-text shadow-xl outline-none", className)} {...props} /></Menu.Positioner></Menu.Portal>
}

function DropdownMenuItem({ className, ...props }: Menu.Item.Props) {
  return <Menu.Item data-slot="dropdown-menu-item" className={cn("flex min-h-control-compact cursor-pointer items-center gap-2 rounded-control px-3 text-body text-text outline-none select-none data-[highlighted]:bg-surface-interactive data-[highlighted]:text-paper-50", className)} {...props} />
}

function DropdownMenuSeparator({ className, ...props }: Menu.Separator.Props) {
  return <Menu.Separator data-slot="dropdown-menu-separator" className={cn("-mx-1 my-1 h-px bg-border-muted", className)} {...props} />
}

export { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger }
