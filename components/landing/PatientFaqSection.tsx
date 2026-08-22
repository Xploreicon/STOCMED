import { HelpCircle, User } from 'lucide-react'

const PATIENT_FAQS = [
  {
    question: 'What is StocMed?',
    answer: 'We show you which pharmacies near you have your medicine in stock.',
  },
  {
    question: 'Is it free?',
    answer: 'Yes, free for patients.',
  },
  {
    question: 'Do I buy through the app?',
    answer: 'No. You go to the pharmacy and pay them directly.',
  },
  {
    question: 'Can I get prescription medicine?',
    answer: 'You need a prescription. The app shows you which pharmacies have it, and you call them.',
  },
  {
    question: 'Does StocMed give medical advice?',
    answer: 'No. We only help you find medicine. Ask a pharmacist or doctor about your health.',
  },
  {
    question: 'Is my data private?',
    answer: 'Yes. You can see and delete your own searches at any time.',
  },
]

export function PatientFaqSection() {
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
            Quick, simple answers about how StocMed works for patients.
          </p>
        </div>

        <div id="faq-patients" className="scroll-mt-24">
          <div className="flex items-center gap-2.5 mb-6">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
              <User className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
            </div>
            <div>
              <span className="text-[12px] font-semibold text-primary uppercase tracking-wider">Patient FAQs</span>
              <h3 className="font-display font-medium text-[22px] sm:text-[26px] text-ink">For Patients</h3>
            </div>
          </div>

          <div className="space-y-3">
            {PATIENT_FAQS.map((item) => (
              <details key={item.question} className="border border-border rounded-card bg-white overflow-hidden transition-colors hover:border-border/80">
                <summary className="w-full gap-4 px-5 py-4 text-left font-medium text-[15px] sm:text-[16px] text-ink hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
                  {item.question}
                </summary>
                <div className="px-5 pb-4 pt-0 text-[14px] sm:text-[15px] leading-[1.6] text-ink-muted border-t border-border/40 mt-1">
                  <p className="pt-2">{item.answer}</p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
