-- AlterTable
ALTER TABLE "User" ADD COLUMN     "termsAcceptedAt" TIMESTAMPTZ(3),
ADD COLUMN     "termsVersion" TEXT;

-- Date et version du consentement vont ensemble.
ALTER TABLE "User" ADD CONSTRAINT "User_terms_consistent" CHECK (("termsAcceptedAt" IS NULL) = ("termsVersion" IS NULL));
