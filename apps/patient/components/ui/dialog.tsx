'use client'

import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

interface DialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}

const DialogContext = React.createContext<((open: boolean) => void) | undefined>(undefined)

const Dialog: React.FC<DialogProps> = ({ open, onOpenChange, children }) => {
  return (
    <>
      {open && (
        <DialogContext.Provider value={onOpenChange}>
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center animate-fade-in">
          <div
            className="fixed inset-0 bg-ink/20 backdrop-blur-sm"
            onClick={() => onOpenChange?.(false)}
          />
          {children}
        </div>
        </DialogContext.Provider>
      )}
    </>
  )
}

interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
  onClose?: () => void
}

const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, children, onClose, ...props }, ref) => {
    const changeOpen = React.useContext(DialogContext)
    const contentRef = React.useRef<HTMLDivElement>(null)
    const closeRef = React.useRef<(() => void) | undefined>(undefined)
    closeRef.current = onClose || (changeOpen ? () => changeOpen(false) : undefined)
    const headingId = React.useId()
    React.useImperativeHandle(ref, () => contentRef.current!)

    React.useEffect(() => {
      const element = contentRef.current
      if (!element) return
      const previousFocus = document.activeElement as HTMLElement | null
      const heading = element.querySelector<HTMLElement>('h1,h2,h3,[role="heading"]')
      if (!element.hasAttribute('aria-label') && !element.hasAttribute('aria-labelledby') && heading) {
        if (!heading.id) heading.id = headingId
        element.setAttribute('aria-labelledby', heading.id)
      }
      const focusable = () => Array.from(element.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]'))
        .filter(item => item.getClientRects().length > 0 && item.getAttribute('aria-hidden') !== 'true')
      ;(focusable()[0] || element).focus()
      const handleKey = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && closeRef.current) {
          event.preventDefault()
          event.stopPropagation()
          closeRef.current()
        }
        if (event.key !== 'Tab') return
        const items = focusable()
        if (!items.length) { event.preventDefault(); element.focus(); return }
        const first = items[0]
        const last = items[items.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) {
          event.preventDefault(); last.focus()
        } else if (!event.shiftKey && (document.activeElement === last || !element.contains(document.activeElement))) {
          event.preventDefault(); first.focus()
        }
      }
      document.addEventListener('keydown', handleKey)
      return () => {
        document.removeEventListener('keydown', handleKey)
        if (previousFocus?.isConnected) previousFocus.focus()
      }
    }, [headingId])

    return (
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cn(
          "relative z-50 bg-white border border-border rounded-t-2xl sm:rounded-card shadow-modal w-full max-w-lg sm:mx-4 max-h-[90dvh] overflow-y-auto animate-slide-up pb-[env(safe-area-inset-bottom)]",
          className
        )}
        {...props}
      >
        {children}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-button text-ink-muted ring-offset-background hover:bg-surface hover:text-ink focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>
        )}
      </div>
    )
  }
)
DialogContent.displayName = "DialogContent"

interface DialogHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

const DialogHeader: React.FC<DialogHeaderProps> = ({ className, ...props }) => (
  <div
    className={cn("flex flex-col space-y-1.5 text-center sm:text-left p-6 pb-4", className)}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

interface DialogFooterProps extends React.HTMLAttributes<HTMLDivElement> {}

const DialogFooter: React.FC<DialogFooterProps> = ({ className, ...props }) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 p-6 pt-4", className)}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

interface DialogTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {}

const DialogTitle = React.forwardRef<HTMLHeadingElement, DialogTitleProps>(
  ({ className, ...props }, ref) => (
    <h2
      ref={ref}
      className={cn("text-lg font-semibold leading-none tracking-tight font-display", className)}
      {...props}
    />
  )
)
DialogTitle.displayName = "DialogTitle"

interface DialogDescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {}

const DialogDescription = React.forwardRef<HTMLParagraphElement, DialogDescriptionProps>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
)
DialogDescription.displayName = "DialogDescription"

export {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
