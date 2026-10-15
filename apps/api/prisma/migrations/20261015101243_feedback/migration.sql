-- E39 : retours utilisateurs (SPEC §13.5).
-- CreateEnum
CREATE TYPE "FeedbackType" AS ENUM ('OPINION', 'IDEA', 'PROBLEM');

-- CreateTable
CREATE TABLE "Feedback" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "type" "FeedbackType" NOT NULL,
    "message" TEXT NOT NULL,
    "treatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Feedback_userId_createdAt_idx" ON "Feedback"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Feedback_createdAt_idx" ON "Feedback"("createdAt");

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Texte borné quel que soit le chemin d'écriture (même borne que FEEDBACK_LIMITS.maxMessageLength).
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_message_length_check" CHECK (char_length("message") BETWEEN 1 AND 2000);
