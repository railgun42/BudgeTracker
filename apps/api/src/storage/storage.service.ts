import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Durée de validité d'une URL signée (SPEC §4 : courte, objets jamais publics).
export const SIGNED_URL_SECONDS = 300;

// S3 (OVH Object Storage en prod, MinIO en dev). Hors prod, repli sur le MinIO de docker-compose.dev.yml.
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket = process.env.S3_BUCKET || 'budgetracker';
  private readonly s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
    region: process.env.S3_REGION || 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID || process.env.MINIO_ROOT_USER || '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.MINIO_ROOT_PASSWORD || '',
    },
  });

  // Bucket créé s'il manque (MinIO vierge en dev/CI) ; privé par défaut, aucune politique publique posée.
  async onModuleInit() {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket })).catch((e: Error) => {
        // Plusieurs processus (fichiers Jest) au démarrage : déjà créé par un autre.
        if (e.name !== 'BucketAlreadyOwnedByYou') this.logger.error(`Bucket S3 indisponible : ${e.message}`);
      });
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (e) {
      if ((e as Error).name === 'NotFound') return false;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  // Tous les objets sous un préfixe (suppression de compte : orphelins compris).
  async deletePrefix(prefix: string): Promise<void> {
    let token: string | undefined;
    do {
      const page = await this.s3.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      await Promise.all((page.Contents ?? []).map((o) => this.delete(o.Key!)));
      token = page.NextContinuationToken;
    } while (token);
  }

  // Content-Type imposé par le serveur (détecté à l'upload), jamais celui annoncé par le client.
  signedUrl(key: string, contentType: string): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentType: contentType }), { expiresIn: SIGNED_URL_SECONDS });
  }
}
