'use client';

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
          <button className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gray-100 hover:bg-primary-blue hover:text-white transition-all text-sm font-medium text-gray-700 group">
            <Pill className="h-4 w-4" />
            {medication}
          </button>
        </Link>
      ))}
    </div>
  );
}
