# StocMed MVP — AI-Powered Medication Search & Pharmacy Inventory Platform

StocMed is a web application designed to help patients search for medications across nearby pharmacies, view real-time stock levels, and query a conversational AI concierge for drug information. Pharmacies can register to manage their inventories via a cloud-based dashboard.

---

## 🛠 Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Database & Authentication**: Supabase (PostgreSQL, Row Level Security, Storage, Auth)
- **AI Integrations**: OpenAI GPT-4o-mini (Chat Concierge)
- **State Management**: Zustand (Client-side search history/auth persistence)
- **Data Fetching**: TanStack React Query (Pharmacy UI/Dashboard caching)
- **Styling**: Tailwind CSS + shadcn/ui primitives

---

## 🏗 Directory Structure

```
stocmed-mvp/
├── app/
│   ├── (auth)/          # Authentication pages (login, signup, callback)
│   ├── (patient)/       # Patient-facing routes (chat, search history, dashboard)
│   ├── (pharmacy)/      # Pharmacy management pages (dashboard, inventory CRUD)
│   ├── api/             # API routes (chat, searches, pharmacy inventory management)
│   └── insights/        # Restricted analytics dashboard for pharmacy users
├── components/          # Reusable UI component library (shadcn, Chat, Inventory)
├── lib/                 # Core utility wrappers & Supabase client builders
├── store/               # Zustand client state definitions
├── supabase/
│   └── migrations/      # Version-controlled database migrations (schema & RLS)
└── types/               # TypeScript interface schemas (Supabase, drugs, searches)
```

---

## ⚙️ Environment Variables Setup

Create a `.env.local` file in the root directory:

```env
# Supabase Connection (Public)
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key

# Supabase Admin / Service Role (Server-only)
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# Database Connection (Direct PostgreSQL Access)
DATABASE_URL=postgresql://postgres:your-db-password@db.your-project-ref.supabase.co:5432/postgres

# OpenAI API Key (for Chat Assistant)
OPENAI_API_KEY=sk-proj-your-openai-api-key
```

---

## 🚀 Running Locally

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Run Development Server**:
   ```bash
   npm run dev
   ```

3. **Production Build**:
   ```bash
   npm run build
   npm run start
   ```

---

## 🔒 Security, RLS, and Database Management

- **Row Level Security (RLS)** is enabled on all tables (`users`, `pharmacies`, `drugs`, `searches`, `chat_messages`).
- All schema alterations and security policies are tracked as version-controlled SQL files in `supabase/migrations/`.
- **Public Search Protection**: The public drug search route (`/api/drugs/search`) runs under standard client privilege to enforce public read RLS constraints rather than bypassing it via the service-role client.

---

## 🧾 POS + Offline Sync & Regulatory Landscape

StocMed features a high-speed, local-first Point of Sale (POS) checkout terminal designed to handle connectivity disruptions (e.g. offline environments, bandwidth throttles):

1. **Local-First indexedDB Storage**: Checkout carts and offline sales are queued client-side using `Dexie.js` in IndexedDB.
2. **Idempotent Sync Route**: Offline queues are synced to `/api/pharmacy/pos/sync` once connectivity is restored, featuring client-side UUID idempotency verification to prevent duplicate sale logs.
3. **PWA Capability**: Registers a custom service worker (`public/sw.js`) and web app manifest (`public/manifest.json`) to cache core layout files, enabling pages to load and function fully offline.
4. **Regulatory Payment Configuration**:
   - `NEXT_PUBLIC_STOCMED_MEDIATED_COLLECTION=false`: Defaults StocMed strictly as a software of record. In this mode, payment collections (Cash, Bank Transfer, POS Terminal) only record the transaction method to log sale events without processing monetary funds. This keeps StocMed clear of Payment Service Provider (PSP) and Pharmacists Council of Nigeria (PCN) legal licenses for monetary clearing.
   - If set to `true`, the platform triggers stubs for API mediated banking integrations.

