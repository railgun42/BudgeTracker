-- AlterTable
ALTER TABLE "Attachment" ALTER COLUMN "transactionId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AttachmentTag" (
    "attachmentId" UUID NOT NULL,
    "tagId" UUID NOT NULL,

    CONSTRAINT "AttachmentTag_pkey" PRIMARY KEY ("attachmentId","tagId")
);

-- CreateIndex
CREATE INDEX "AttachmentTag_tagId_idx" ON "AttachmentTag"("tagId");

-- AddForeignKey
ALTER TABLE "AttachmentTag" ADD CONSTRAINT "AttachmentTag_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttachmentTag" ADD CONSTRAINT "AttachmentTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
