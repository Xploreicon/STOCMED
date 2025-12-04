import * as React from "react"
import { cn } from "@/lib/utils"

export interface DropdownMenuProps {
  children: React.ReactNode
}

export const DropdownMenu: React.FC<DropdownMenuProps> = ({ children }) => {
  const [open, setOpen] = React.useState(false)

  return (
    <div className="relative" onBlur={() => setTimeout(() => setOpen(false), 200)}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as React.ReactElement<any>, { open, setOpen })
        }
        return child
      })}
    </div>
  )
}

export interface DropdownMenuTriggerProps {
  children: React.ReactNode
  asChild?: boolean
  open?: boolean
  setOpen?: (open: boolean) => void
}

export const DropdownMenuTrigger: React.FC<DropdownMenuTriggerProps> = ({
  children,
  asChild,
  open,
  setOpen
}) => {
  const handleClick = () => {
    setOpen?.(!open)
  }

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<any>, {
      onClick: handleClick,
    })
  }

  return (
    <button onClick={handleClick}>
      {children}
    </button>
  )
}

export interface DropdownMenuContentProps {
  children: React.ReactNode
  align?: 'start' | 'center' | 'end'
  className?: string
  open?: boolean
}

export const DropdownMenuContent: React.FC<DropdownMenuContentProps> = ({
  children,
  align = 'start',
  className,
  open
}) => {
  if (!open) return null

  const alignmentClasses = {
    start: 'left-0',
    center: 'left-1/2 -translate-x-1/2',
    end: 'right-0',
  }

  return (
    <div
      className={cn(
        "absolute top-full mt-2 z-50 min-w-[8rem] overflow-hidden rounded-md border border-gray-200 bg-white p-1 shadow-md",
        alignmentClasses[align],
        className
      )}
    >
      {children}
    </div>
  )
}

export interface DropdownMenuItemProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}

export const DropdownMenuItem: React.FC<DropdownMenuItemProps> = ({
  children,
  className,
  ...props
}) => {
  return (
    <div
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-gray-100 focus:bg-gray-100 focus:text-gray-900",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export const DropdownMenuSeparator: React.FC<{ className?: string }> = ({ className }) => {
  return <div className={cn("my-1 h-px bg-gray-200", className)} />
}
