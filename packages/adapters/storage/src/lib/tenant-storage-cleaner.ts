import {
  AbortMultipartUploadCommand,
  DeleteObjectsCommand,
  GetBucketVersioningCommand,
  HeadBucketCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { S3ObjectStorageOptions } from './adapter-storage.js';
import { createHash } from 'node:crypto';

export function tenantStorageOptions(): S3ObjectStorageOptions {
  return {
    internalEndpoint:
      process.env.S3_INTERNAL_ENDPOINT ??
      process.env.S3_ENDPOINT ??
      'http://localhost:9010',
    publicEndpoint:
      process.env.S3_PUBLIC_ENDPOINT ??
      process.env.S3_ENDPOINT ??
      'http://localhost:9010',
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? 'enterprise-platform',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'platform',
    secretAccessKey:
      process.env.S3_SECRET_ACCESS_KEY ?? 'platform-development-secret',
  };
}

export class TenantStorageCleaner {
  private readonly client: S3Client;
  private readonly bucket: string;
  readonly location: string;

  constructor(options: S3ObjectStorageOptions = tenantStorageOptions()) {
    this.bucket = options.bucket;
    const endpoint = options.internalEndpoint ?? options.endpoint;
    this.location = `${endpoint ?? 'aws-s3'}|${options.region ?? 'us-east-1'}|${options.bucket}`;
    this.client = new S3Client({
      endpoint,
      region: options.region ?? 'us-east-1',
      forcePathStyle: options.forcePathStyle ?? Boolean(endpoint),
      credentials:
        options.accessKeyId && options.secretAccessKey
          ? {
              accessKeyId: options.accessKeyId,
              secretAccessKey: options.secretAccessKey,
            }
          : undefined,
    });
  }

  async inspect(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    await this.client.send(
      new GetBucketVersioningCommand({ Bucket: this.bucket }),
    );
  }

  async purge(
    tenantId: string,
    assertOwnership: () => Promise<void>,
  ): Promise<void> {
    const prefix = this.prefix(tenantId);
    const Bucket = this.bucket;
    const versioning = await this.client.send(
      new GetBucketVersioningCommand({ Bucket }),
    );
    // Always re-read the first page after deleting it. Pagination tokens can
    // become invalid as versions are removed; this also makes retry idempotent.
    for (;;) {
      await assertOwnership();
      const objects = versioning.Status
        ? await this.client
            .send(
              new ListObjectVersionsCommand({
                Bucket,
                Prefix: prefix,
                MaxKeys: 1000,
              }),
            )
            .then((page) =>
              [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])].map(
                ({ Key, VersionId }) => ({ Key, VersionId }),
              ),
            )
        : await this.client
            .send(
              new ListObjectsV2Command({
                Bucket,
                Prefix: prefix,
                MaxKeys: 1000,
              }),
            )
            .then((page) => (page.Contents ?? []).map(({ Key }) => ({ Key })));
      if (!objects.length) break;
      if (objects.some(({ Key }) => !Key?.startsWith(prefix)))
        throw new Error('STORAGE_PREFIX_MISMATCH');
      await assertOwnership();
      const command = new DeleteObjectsCommand({
        Bucket,
        Delete: { Objects: objects, Quiet: true },
      });
      // MinIO 2023 requires Content-MD5 even when the SDK adds a CRC checksum.
      // Hash the serialized XML body, before the signing middleware runs.
      command.middlewareStack.add(
        (next) => async (args) => {
          const request = args.request as {
            body: string;
            headers: Record<string, string>;
          };
          request.headers['content-md5'] = createHash('md5')
            .update(request.body)
            .digest('base64');
          return next(args);
        },
        { step: 'build', name: 'deleteObjectsContentMd5' },
      );
      const result = await this.client.send(command);
      if (result.Errors?.length) throw new Error('STORAGE_DELETE_INCOMPLETE');
    }
    for (;;) {
      await assertOwnership();
      const page = await this.client.send(
        new ListMultipartUploadsCommand({
          Bucket,
          Prefix: prefix,
          MaxUploads: 1000,
        }),
      );
      if (!page.Uploads?.length) break;
      for (const upload of page.Uploads) {
        if (!upload.Key?.startsWith(prefix))
          throw new Error('STORAGE_PREFIX_MISMATCH');
        await assertOwnership();
        await this.client.send(
          new AbortMultipartUploadCommand({
            Bucket,
            Key: upload.Key,
            UploadId: upload.UploadId,
          }),
        );
      }
    }
    const remaining = await this.client.send(
      new ListObjectsV2Command({ Bucket, Prefix: prefix, MaxKeys: 1 }),
    );
    if (remaining.Contents?.length)
      throw new Error('STORAGE_DELETE_INCOMPLETE');
  }

  close(): void {
    this.client.destroy();
  }
  private prefix(tenantId: string): string {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        tenantId,
      )
    )
      throw new Error('INVALID_TENANT_ID');
    return `tenants/${tenantId}/`;
  }
}
