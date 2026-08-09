'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'

export type SettingsSection = 'profile' | 'security' | 'account' | 'features'

const sections: Array<{ key: SettingsSection; label: string }> = [
  { key: 'profile', label: 'Pharmacy profile' },
  { key: 'security', label: 'SP controls' },
  { key: 'account', label: 'Account' },
  { key: 'features', label: 'Features' },
]

export function SettingsTabStrip({
  active,
  onSectionChange,
}: {
  active: SettingsSection
  onSectionChange?: (section: Exclude<SettingsSection, 'features'>) => void
}) {
  const itemClass = (section: SettingsSection) => cn(
    'inline-flex min-h-11 items-center justify-center rounded-button px-4 text-sm font-semibold transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
    active === section
      ? 'bg-primary text-white shadow-sm'
      : 'text-ink-muted hover:bg-white hover:text-ink',
  )

  return (
    <nav
      aria-label="Pharmacy settings sections"
      className="overflow-x-auto rounded-button border border-border bg-surface p-1"
    >
      <div className="flex min-w-max items-center gap-1">
        {sections.map(section => {
          if (section.key === 'features') {
            return (
              <Link
                key={section.key}
                href="/pharmacy/settings/features"
                aria-current={active === section.key ? 'page' : undefined}
                className={itemClass(section.key)}
              >
                {section.label}
              </Link>
            )
          }

          if (onSectionChange) {
            const localSection = section.key as Exclude<SettingsSection, 'features'>
            return (
              <button
                key={section.key}
                type="button"
                aria-current={active === section.key ? 'page' : undefined}
                onClick={() => onSectionChange(localSection)}
                className={itemClass(section.key)}
              >
                {section.label}
              </button>
            )
          }

          return (
            <Link
              key={section.key}
              href={`/pharmacy/settings?tab=${section.key}`}
              aria-current={active === section.key ? 'page' : undefined}
              className={itemClass(section.key)}
            >
              {section.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
