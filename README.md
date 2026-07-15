# Solar Store Management System

Enterprise-grade management system for a solar equipment retail store (solar panels, inverters, batteries). Covers the full commercial cycle: purchasing from suppliers, multi-warehouse inventory with serial-number tracking, quotations, sales orders, invoicing with PDF generation, payments & installment plans, refunds/returns, warranty claims, installation/service jobs, reports with export, notifications, and a full audit trail.

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | NestJS 11 (TypeScript), Prisma ORM, PostgreSQL |
| Frontend | Next.js 15 (App Router, TypeScript), Tailwind CSS + shadcn/ui-style components, Lucide icons, Recharts |
| i18n | next-intl — English + Arabic with full RTL support |
| Theme | next-themes — light/dark with system detection |
| Auth | JWT access tokens + rotating refresh tokens, bcrypt, account lockout, login history |
| API docs | Swagger/OpenAPI at `/api/docs` |
| Security | Helmet, compression, rate limiting (@nestjs/throttler), global validation & exception filters |
| Files | Local uploads (multer) with type/size validation |
| Exports | CSV / Excel (exceljs) report exports, PDF invoices (pdf-lib) |

## Repo Structure

```
SolarManagementSystem/
├── backend/            # NestJS API
│   ├── prisma/         # schema.prisma, migrations, seed
│   └── src/            # modules: auth, products, inventory, clients, suppliers,
│                       #   quotations, sales-orders, purchase-orders, invoices,
│                       #   payments, refunds, warranty, service-jobs, reports,
│                       #   notifications, settings, uploads, audit
├── frontend/           # Next.js app (App Router)
│   └── src/
│       ├── app/        # routes (login + authenticated (app) group)
│       ├── components/ # ui kit + data-table, pickers, line-items editor
│       ├── i18n/       # en.json / ar.json messages
│       └── lib/        # api client, chart palette, utils
├── docker-compose.yml  # Postgres + backend + frontend
└── README.md
```

## Local Setup

### Prerequisites

- Node.js 20+ and PostgreSQL 14+ (or use Docker, below)

### Backend

```bash
cd backend
npm install
copy .env.example .env    # fill in DATABASE_URL and JWT_SECRET
npx prisma migrate dev
npx prisma db seed        # creates the Admin user, categories, sequences
npm run start:dev         # API on http://localhost:3000/api (Swagger at /api/docs)
```

### Frontend

```bash
cd frontend
npm install
npm run dev               # app on http://localhost:5173
```

**Default admin login** (change after first login): `admin@solarstore.local` / `admin123`

## Docker

```bash
docker compose up --build
# frontend: http://localhost:5173 · API: http://localhost:3000/api · docs: /api/docs
```

## Key Features

- **Flexible catalog** — categories → sub-categories → custom attribute definitions (EAV via JSON), so new product types need no code changes
- **Daily price changes** — every cost/sale price change is logged to price history with reason & user; invoices always store price snapshots; bulk CSV price import
- **Serial-number traceability** — units tracked from goods receipt through sale to warranty claim; warranty clocks (product + performance) start at invoicing
- **Installments** — payment schedules per invoice with due/overdue alerts
- **Refund workflow** — pending → approved → completed with restock (resellable) or damaged stock separation and store-credit support
- **Credit limits** — order confirmation blocks clients over their limit
- **Reports** — dashboard KPIs & charts, profit by product, inventory valuation, receivables aging, payables, cash flow, warranty stats, reorder suggestions — exportable to CSV/Excel
- **Hourly background checks** — low stock, overdue invoices/installments, expiring quotations/warranties, lead-acid shelf-life alerts
- **Soft delete + audit log** on all business entities, UUID primary keys throughout
