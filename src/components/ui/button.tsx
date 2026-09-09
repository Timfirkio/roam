import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const buttonVariants = cva(
  "group/button inline-flex min-w-0 shrink-0 items-center justify-center rounded-control border bg-clip-padding font-sans text-body-lg font-medium whitespace-normal backdrop-blur-md transition-colors duration-150 ease-outdoor outline-none select-none focus-visible:ring-3 focus-visible:ring-focus focus-visible:ring-offset-3 focus-visible:ring-offset-ink-950 disabled:pointer-events-none disabled:border-border-muted disabled:bg-surface disabled:text-text-subtle disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: "border-accent bg-accent-button text-paper-50 hover:border-accent hover:bg-accent-button-hover active:border-accent active:bg-accent-button-hover",
        secondary:
          "border-border bg-surface-raised text-text hover:border-border-strong hover:bg-surface-interactive active:border-accent active:bg-accent-muted aria-expanded:bg-surface-interactive",
        ghost:
          "border-transparent bg-transparent text-text-muted hover:border-border-muted hover:bg-surface-raised hover:text-text",
        destructive:
          "border-danger-500 bg-danger-button text-paper-50 hover:border-paper-50 hover:bg-danger-button-hover active:border-paper-50 active:bg-danger-button-hover",
      },
      size: {
        default:
          "min-h-control gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "min-h-6 gap-1 px-2 text-label",
        sm: "min-h-control-compact gap-1.5 px-3 text-body",
        lg: "min-h-control gap-2 px-5",
        icon: "size-control rounded-control p-0",
        "icon-xs":
          "size-6 rounded-control in-data-[slot=button-group]:rounded-control [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-control in-data-[slot=button-group]:rounded-control",
        "icon-lg": "size-9 rounded-control",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "primary",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
