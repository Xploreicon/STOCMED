# StocMed MVP — AI-Powered Medication Search & Pharmacy Inventory Platform

StocMed is a web application designed to help patients search for medications across nearby pharmacies, view real-time stock levels, and query a safety-gated AI concierge for drug information. Pharmacies can register to manage their inventories, procurement, shifts, reports, and high-speed offline-resilient POS terminals via a cloud-based operational dashboard.

---

## 🛠 Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Database & Authentication**: Supabase (PostgreSQL 17, Row Level Security, Storage, Auth)
- **AI Integrations**: Anthropic Claude (Single Haiku model integration for AI Assistant and safety triage)
- **Observability & Error Tracking**: Sentry (Server & Client with automatic PII scrubbing)
- **State & Offline Storage**: Zustand + Dexie.js (IndexedDB POS queueing)
- **Data Fetching**: TanStack React Query (Dashboard caching)
- **Styling**: Tailwind CSS + shadcn/ui components

---

## 🏗 Directory Structure

```
stocmed-mvp/
├── app/
│   ├── (auth)/          # Authentication pages (login, signup, callback, reset)
│   ├── (patient)/       # Patient routes (chat, search, history, dashboard)
│   ├── (pharmacy)/      # Pharmacy ops (inventory, POS, shifts, procurement, reports)
│   ├── admin/           # Administrative audit & safety queue routes
│   └── api/             # Secure API endpoints (validated with Zod schemas)
├── components/          # UI components (brand, patient, pharmacy, POS, layout)
├── lib/                 # DB abstractions, validation, triage, and observability
├── store/               # Zustand store modules
├── supabase/
│   └── migrations/      # Version-controlled SQL schema & RLS policies
└── types/               # TypeScript definitions
```

---

## ⚙️ Environment Variables Setup

Create a `.env.local` file in the root directory using the following variable names (do NOT commit real values):

```env
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
DATABASE_URL
ANTHROPIC_API_KEY
ANTHROPIC_TRIAGE_MODEL
ANTHROPIC_ASSISTANT_MODEL
NEXT_PUBLIC_STOCMED_MEDIATED_COLLECTION
STOCMED_MEDIATED_COLLECTION
NEXT_PUBLIC_SENTRY_DSN
SENTRY_DSN
SENTRY_AUTH_TOKEN
```

---

## 🚀 Running Locally

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Run Local Database Migrations**:
   ```bash
   npx supabase db reset
   ```

3. **Development Server**:
   ```bash
   npm run dev
   ```

4. **Production Build & Verification**:
   ```bash
   npm run build
   npm run test
   ```

### Local Test Accounts (Seeded locally only)
- Cashier: `pharmacy.test@stocmed.local` / `StocMedTest123!`
- Patient: `patient.test@stocmed.local` / `StocMedTest123!`

---

## 🔒 Security, RLS & Compliance Architecture

- **Row Level Security (RLS)** is strictly enabled across 100% of public database tables (`users`, `pharmacies`, `products`, `pharmacy_inventory`, `batches`, `stock_movements`, `sales`, `sale_items`, `procurement_orders`, `purchase_order_items`, `receipts`, `receipt_items`, `shift_sessions`, `triage_logs`, `rx_submissions`, `symptom_intakes`, `research_consent`).
- **Service Role Isolation**: `SUPABASE_SERVICE_ROLE_KEY` is restricted to server-side execution behind active authentication session checks.
- **Sentry PII Scrubbing**: Patient medical search queries, triage inputs, phone numbers, and health data are scrubbed before transmitting breadcrumbs or errors to Sentry.

---

## 🧾 POS & Regulatory Collection Policy

StocMed features a high-speed, local-first Point of Sale (POS) checkout terminal designed to handle connectivity disruptions:
1. **Local-First indexedDB Storage**: Checkout carts and offline sales are queued client-side using Dexie.js.
2. **Idempotent Sync Route**: Offline queues sync to `/api/pharmacy/pos/sync` with UUID deduplication.
3. **STOCMED_MEDIATED_COLLECTION Guard**: In production, `STOCMED_MEDIATED_COLLECTION` MUST be set to `false`. A hard server-side runtime guard enforces this setting, operating StocMed strictly as a software-of-record (recording transaction methods without receiving or clearing patient funds directly).
