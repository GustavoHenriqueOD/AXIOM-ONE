-- CreateEnum
CREATE TYPE "WealthItemType" AS ENUM ('ASSET', 'LIABILITY');

-- CreateEnum
CREATE TYPE "RateFrequency" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "ContributionFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "indexer" TEXT,
ADD COLUMN     "rate" DECIMAL(8,4);

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "isEssential" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "investmentEntryId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "fireMonthlyExpense" DECIMAL(14,2),
ADD COLUMN     "fireNumberManual" DECIMAL(14,2),
ADD COLUMN     "fireRetirementYears" INTEGER,
ADD COLUMN     "fireSWR" DECIMAL(5,2),
ADD COLUMN     "fireTargetInvestedAmount" DECIMAL(14,2),
ADD COLUMN     "fireTargetMonthlyContrib" DECIMAL(14,2),
ADD COLUMN     "fireTargetMonthlyIncome" DECIMAL(14,2),
ADD COLUMN     "patrimonyGoal" DECIMAL(65,30);

-- CreateTable
CREATE TABLE "WealthItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "itemType" "WealthItemType" NOT NULL,
    "category" TEXT NOT NULL,
    "appreciationRate" DECIMAL(7,4),
    "appreciationStart" TIMESTAMP(3),
    "rateFrequency" "RateFrequency" NOT NULL DEFAULT 'ANNUAL',
    "loanBank" TEXT,
    "loanInstallments" INTEGER,
    "loanStartDate" TIMESTAMP(3),
    "loanDueDay" INTEGER,
    "linkedCategoryId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WealthItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WealthItemInstallment" (
    "id" TEXT NOT NULL,
    "wealthItemId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "InstallmentStatus" NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WealthItemInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialGoal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetAmount" DECIMAL(14,2) NOT NULL,
    "savedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "contributionAmount" DECIMAL(14,2) NOT NULL,
    "contributionFrequency" "ContributionFrequency" NOT NULL,
    "bank" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialGoal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WealthItem_userId_itemType_idx" ON "WealthItem"("userId", "itemType");

-- CreateIndex
CREATE UNIQUE INDEX "WealthItemInstallment_wealthItemId_month_year_key" ON "WealthItemInstallment"("wealthItemId", "month", "year");

-- CreateIndex
CREATE INDEX "InvestmentEntry_userId_date_idx" ON "InvestmentEntry"("userId", "date");

-- CreateIndex
CREATE INDEX "InvestmentEntry_userId_assetId_idx" ON "InvestmentEntry"("userId", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_investmentEntryId_key" ON "JournalEntry"("investmentEntryId");

-- CreateIndex
CREATE INDEX "JournalEntry_userId_date_idx" ON "JournalEntry"("userId", "date");

-- CreateIndex
CREATE INDEX "Transaction_userId_date_idx" ON "Transaction"("userId", "date");

-- CreateIndex
CREATE INDEX "Transaction_userId_type_idx" ON "Transaction"("userId", "type");

-- CreateIndex
CREATE INDEX "Transaction_userId_categoryId_idx" ON "Transaction"("userId", "categoryId");

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_investmentEntryId_fkey" FOREIGN KEY ("investmentEntryId") REFERENCES "InvestmentEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WealthItem" ADD CONSTRAINT "WealthItem_linkedCategoryId_fkey" FOREIGN KEY ("linkedCategoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WealthItem" ADD CONSTRAINT "WealthItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WealthItemInstallment" ADD CONSTRAINT "WealthItemInstallment_wealthItemId_fkey" FOREIGN KEY ("wealthItemId") REFERENCES "WealthItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialGoal" ADD CONSTRAINT "FinancialGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
