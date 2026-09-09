import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { cn } from "cn"

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-pill border transition-colors duration-150 ease-outdoor outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-3 focus-visible:ring-focus focus-visible:ring-offset-3 focus-visible:ring-offset-ink-950 data-[size=default]:h-[18px] data-[size=default]:w-[34px] data-[size=sm]:h-[14px] data-[size=sm]:w-[24px] data-checked:border-accent data-checked:bg-accent-muted data-unchecked:border-border-strong data-unchecked:bg-control-off data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full ring-0 transition-transform duration-150 ease-outdoor group-data-[size=default]/switch:size-2.5 group-data-[size=sm]/switch:size-2 group-data-[size=default]/switch:data-checked:translate-x-4 group-data-[size=sm]/switch:data-checked:translate-x-[11px] group-data-[size=default]/switch:data-unchecked:translate-x-[3px] group-data-[size=sm]/switch:data-unchecked:translate-x-[2px] group-data-[size=default]/switch:data-checked:bg-paper-100 group-data-[size=default]/switch:data-unchecked:bg-slate-400 group-data-[size=sm]/switch:data-checked:bg-paper-100 group-data-[size=sm]/switch:data-unchecked:bg-slate-400"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
