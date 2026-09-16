import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const buttonVariants = cva(
  "group/button inline-flex min-w-0 shrink-0 items-center justify-center rounded-control border bg-clip-padding font-sans font-medium whitespace-normal backdrop-blur-md transition-colors duration-150 ease-outdoor outline-none select-none focus-visible:ring-3 focus-visible:ring-focus focus-visible:ring-offset-3 focus-visible:ring-offset-ink-950 disabled:pointer-events-none disabled:border-border-muted disabled:bg-surface disabled:text-text-subtle disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
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
        large: "min-h-control gap-2 px-4 text-body-lg has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        medium: "min-h-control-medium gap-1.5 px-3 text-body",
        small: "min-h-8 gap-1.5 px-3 text-label",
        "icon-large": "size-control rounded-control p-0",
        "icon-medium": "size-[2.375rem] rounded-control p-0 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-small": "size-8 rounded-control p-0 [&_svg:not([class*='size-'])]:size-3",
        // Compatibility aliases: use large, medium, small and their icon counterparts for new work.
        default: "min-h-control-compact gap-1.5 px-3 text-body",
        xs: "min-h-8 gap-1.5 px-3 text-label",
        sm: "min-h-control-compact gap-1.5 px-3 text-body",
        compact: "min-h-8 gap-1.5 px-3 text-label",
        lg: "min-h-control gap-2 px-4 text-body-lg",
        icon: "size-control rounded-control p-0",
        "icon-xs": "size-8 rounded-control p-0 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9 rounded-control p-0 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-compact": "size-8 rounded-control p-0 [&_svg:not([class*='size-'])]:size-3",
        "icon-lg": "size-control rounded-control p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "medium",
    },
  }
)

function Button({
  className,
  variant = "primary",
  size = "medium",
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
