-- CreateTable
CREATE TABLE "DashboardPreference" (
    "userId" UUID NOT NULL,
    "prefs" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardPreference_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "DashboardPreference" ADD CONSTRAINT "DashboardPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
