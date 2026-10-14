-- CreateTable
CREATE TABLE "CashflowSimulation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashflowSimulation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashflowSimulation_userId_idx" ON "CashflowSimulation"("userId");

-- AddForeignKey
ALTER TABLE "CashflowSimulation" ADD CONSTRAINT "CashflowSimulation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
