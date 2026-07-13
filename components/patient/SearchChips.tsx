'use client';

import { Button } from '@/components/ui/button'

import Link from 'next/link';
import { Pill } from 'lucide-react';

const commonMedications = [
  'Paracetamol',
  'Amoxicillin',
  'Ibuprofen',
  'Vitamin C',
  'Metformin',
  'Lisinopril',
  'Amlodipine',
  'Omeprazole',
];

export default function SearchChips() {
  return (
    <div className="flex flex-wrap gap-2">
      {commonMedications.map((medication) => (
        <Link
          key={medication}
          href={`/chat?q=${encodeURIComponent(medication)}`}
        >
          <Button className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-surface border border-border hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all duration-150 text-sm font-medium text-ink group">
            <Pill className="h-4 w-4" />
            {medication}
          </Button>
        </Link>
      ))}
    </div>
  );
}
