import * as React from "react"
import { cn } from "@/lib/utils"

export interface DropdownMenuProps {
  children: React.ReactNode
}

export const DropdownMenu: React.FC<DropdownMenuProps> = ({ children }) => {
  const [open, setOpen] = React.useState(false)

  return (
    <div className="relative" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
    }} onKeyDown={event => {
      if (event.key === 'Escape') {
        setOpen(false)
        event.currentTarget.querySelector<HTMLElement>('[aria-haspopup]')?.focus()
      }
    }}>
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
      'aria-expanded': open,
      'aria-haspopup': 'menu',
    })
  }

  return (
    <button type="button" onClick={handleClick} aria-expanded={open} aria-haspopup="menu">
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
      role="menu"
      className={cn(
        "absolute top-full mt-2 z-50 min-w-[8rem] overflow-hidden rounded-card border border-border bg-popover p-1 shadow-dropdown text-popover-foreground animate-in fade-in-80 slide-in-from-top-1",
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
      role="menuitem"
      tabIndex={0}
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-surface focus:bg-surface focus:text-foreground",
        className
      )}
      {...props}
      onKeyDown={event => {
        props.onKeyDown?.(event)
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.click() }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const items = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="menuitem"]') || [])
          const index = items.indexOf(event.currentTarget)
          items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
        }
      }}
    >
      {children}
    </div>
  )
}

export const DropdownMenuSeparator: React.FC<{ className?: string }> = ({ className }) => {
  return <div className={cn("-mx-1 my-1 h-px bg-border", className)} />
}
