-- E37 : rôle administrateur (SPEC §13.1) et journal des actions d'administration.
-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'USER';

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "adminId" UUID,
    "action" TEXT NOT NULL,
    "targetId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Un administrateur a toujours un e-mail vérifié (SPEC §13.1), quel que soit le chemin d'écriture.
ALTER TABLE "User" ADD CONSTRAINT "User_admin_verified_check" CHECK ("role" <> 'ADMIN' OR "emailVerifiedAt" IS NOT NULL);
