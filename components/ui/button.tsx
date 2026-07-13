import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-button text-sm font-bold ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:grayscale-[0.5] active:scale-[0.98] transition-all duration-150",
  {
    variants: {
      variant: {
        default: "bg-primary text-white shadow-md shadow-primary/20 hover:bg-[var(--primary-hover)] hover:shadow-lg hover:shadow-primary/25 hover:-translate-y-[1px]",
        destructive: "bg-destructive text-white shadow-md shadow-destructive/20 hover:bg-destructive/90",
        outline: "border-[1.5px] border-primary bg-white text-primary shadow-sm hover:bg-primary/5 hover:shadow-md hover:-translate-y-[1px]",
        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-surface hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        "white-on-dark": "bg-white text-[var(--pos-bg)] font-bold shadow-md hover:bg-surface hover:shadow-lg hover:-translate-y-[1px]",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-9 rounded-button px-4",
        lg: "h-12 rounded-button px-8 text-sm",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
