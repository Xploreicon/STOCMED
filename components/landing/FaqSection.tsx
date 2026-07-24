'use client';

import { useState } from 'react';
import { ChevronDown, HelpCircle, Building2, User } from 'lucide-react';

interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

const PATIENT_FAQS: FaqItem[] = [
  {
    id: 'pat-1',
    question: 'What is StocMed?',
    answer: 'We show you which pharmacies near you have your medicine in stock.',
  },
  {
    id: 'pat-2',
    question: 'Is it free?',
    answer: 'Yes, free for patients.',
  },
  {
    id: 'pat-3',
    question: 'Do I buy through the app?',
    answer: 'No. You go to the pharmacy and pay them directly.',
  },
  {
    id: 'pat-4',
    question: 'Can I get prescription medicine?',
    answer: 'You need a prescription. The app shows you which pharmacies have it, and you call them.',
  },
  {
    id: 'pat-5',
    question: 'Does StocMed give medical advice?',
    answer: 'No. We only help you find medicine. Ask a pharmacist or doctor about your health.',
  },
  {
    id: 'pat-6',
    question: 'Is my data private?',
    answer: 'Yes. You can see and delete your own searches at any time.',
  },
];

const PHARMACY_FAQS: FaqItem[] = [
  {
    id: 'pharm-1',
    question: 'What does StocMed do for my pharmacy?',
    answer: 'It manages your stock, tracks expiry dates, runs your till, and shows your medicines to patients searching nearby.',
  },
  {
    id: 'pharm-2',
    question: 'How much does it cost?',
    answer: 'Free to start.',
  },
  {
    id: 'pharm-3',
    question: 'Does it work without internet?',
    answer: 'Yes. The till keeps working and syncs later.',
  },
  {
    id: 'pharm-4',
    question: 'Can I sell groceries too?',
    answer: 'Yes. Medicines and store items in one system, one till.',
  },
  {
    id: 'pharm-5',
    question: 'Do I have to leave QuickBooks?',
    answer: 'No. Keep it for accounts; we export to it.',
  },
  {
    id: 'pharm-6',
    question: 'Does StocMed take my money?',
    answer: 'No. Patients pay you directly.',
  },
  {
    id: 'pharm-7',
    question: 'How do I start?',
    answer: 'Send us your stock list. We import it for you.',
  },
];

function FaqAccordionGroup({
  title,
  icon: Icon,
  badgeText,
  items,
  openId,
  onToggle,
  idPrefix,
}: {
  title: string;
  icon: typeof User;
  badgeText: string;
  items: FaqItem[];
  openId: string | null;
  onToggle: (id: string) => void;
  idPrefix: string;
}) {
  return (
    <div id={`faq-${idPrefix}`} className="scroll-mt-24">
      <div className="flex items-center gap-2.5 mb-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
        </div>
        <div>
          <span className="text-[12px] font-semibold text-primary uppercase tracking-wider">{badgeText}</span>
          <h3 className="font-display font-medium text-[22px] sm:text-[26px] text-ink">{title}</h3>
        </div>
      </div>

      <div className="space-y-3">
        {items.map((item) => {
          const isOpen = openId === item.id;
          const buttonId = `faq-btn-${item.id}`;
          const contentId = `faq-content-${item.id}`;

          return (
            <div
              key={item.id}
              className="border border-border rounded-card bg-white overflow-hidden transition-colors hover:border-border/80"
            >
              <button
                type="button"
                id={buttonId}
                aria-expanded={isOpen}
                aria-controls={contentId}
                onClick={() => onToggle(item.id)}
                className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left font-medium text-[15px] sm:text-[16px] text-ink hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                <span>{item.question}</span>
                <ChevronDown
                  className={`h-5 w-5 shrink-0 text-ink-muted transition-transform duration-200 ${
                    isOpen ? 'rotate-180 text-primary' : ''
                  }`}
                  aria-hidden="true"
                />
              </button>

              {isOpen && (
                <div
                  id={contentId}
                  role="region"
                  aria-labelledby={buttonId}
                  className="px-5 pb-4 pt-0 text-[14px] sm:text-[15px] leading-[1.6] text-ink-muted border-t border-border/40 mt-1"
                >
                  <p className="pt-2">{item.answer}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function FaqSection() {
  const [openPatientId, setOpenPatientId] = useState<string | null>('pat-1');
  const [openPharmacyId, setOpenPharmacyId] = useState<string | null>('pharm-1');

  const handlePatientToggle = (id: string) => {
    setOpenPatientId((prev) => (prev === id ? null : id));
  };

  const handlePharmacyToggle = (id: string) => {
    setOpenPharmacyId((prev) => (prev === id ? null : id));
  };

  return (
    <section id="faq" className="px-4 sm:px-6 py-20 sm:py-24 bg-surface border-t border-border scroll-mt-16">
      <div className="mx-auto max-w-[1200px]">
        <div className="text-center max-w-[640px] mx-auto mb-14">
          <div className="inline-flex items-center gap-2 bg-white border border-border rounded-full px-3.5 py-1.5 mb-4 shadow-sm">
            <HelpCircle className="h-4 w-4 text-primary" aria-hidden="true" />
            <span className="text-[13px] font-medium text-ink-muted">Got questions? We have answers.</span>
          </div>
          <h2 className="font-display font-medium text-[30px] sm:text-[40px] leading-[1.15] text-ink">
            Frequently Asked Questions
          </h2>
          <p className="text-[15px] sm:text-[16px] text-ink-muted mt-3">
            Quick, simple answers about how StocMed works for patients and pharmacies.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-start">
          <FaqAccordionGroup
            title="For Patients"
            icon={User}
            badgeText="Patient FAQs"
            items={PATIENT_FAQS}
            openId={openPatientId}
            onToggle={handlePatientToggle}
            idPrefix="patients"
          />

          <FaqAccordionGroup
            title="For Pharmacies"
            icon={Building2}
            badgeText="Pharmacy FAQs"
            items={PHARMACY_FAQS}
            openId={openPharmacyId}
            onToggle={handlePharmacyToggle}
            idPrefix="pharmacies"
          />
        </div>
      </div>
    </section>
  );
}
