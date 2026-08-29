import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { UploadsModule } from './uploads/uploads.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { ProductsModule } from './products/products.module';
import { InventoryModule } from './inventory/inventory.module';
import { ProductHistoryModule } from './product-history/product-history.module';
import { ClientsModule } from './clients/clients.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { QuotationsModule } from './quotations/quotations.module';
import { SalesOrdersModule } from './sales-orders/sales-orders.module';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';
import { PurchaseReturnsModule } from './purchase-returns/purchase-returns.module';
import { UsersModule } from './users/users.module';
import { InvoicesModule } from './invoices/invoices.module';
import { PaymentsModule } from './payments/payments.module';
import { RefundsModule } from './refunds/refunds.module';
import { WarrantyModule } from './warranty/warranty.module';
import { ServiceJobsModule } from './service-jobs/service-jobs.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReportsModule } from './reports/reports.module';
import { SettingsModule } from './settings/settings.module';
import { AuditModule } from './audit/audit.module';
import { InstallationsModule } from './installations/installations.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { ExpensesModule } from './expenses/expenses.module';
import { WorkersModule } from './workers/workers.module';
import { SolarCalculatorModule } from './solar-calculator/solar-calculator.module';
import { BackupModule } from './backup/backup.module';
import { CronModule } from './cron/cron.module';
import { SuperadminModule } from './superadmin/superadmin.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 300 }]),
    PrismaModule,
    UploadsModule,
    CommonModule,
    AuthModule,
    SuperadminModule,
    UsersModule,
    CategoriesModule,
    ProductsModule,
    InventoryModule,
    ProductHistoryModule,
    ClientsModule,
    SuppliersModule,
    QuotationsModule,
    SalesOrdersModule,
    PurchaseOrdersModule,
    PurchaseReturnsModule,
    InvoicesModule,
    PaymentsModule,
    RefundsModule,
    WarrantyModule,
    ServiceJobsModule,
    NotificationsModule,
    ReportsModule,
    SettingsModule,
    AuditModule,
    InstallationsModule,
    MaintenanceModule,
    ExpensesModule,
    WorkersModule,
    SolarCalculatorModule,
    BackupModule,
    CronModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
