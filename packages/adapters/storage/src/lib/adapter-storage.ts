import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface ObjectStorageUpload {
  readonly key: string;
  readonly contentType: string;
  readonly expiresInSeconds?: number;
}

export interface ObjectStoragePut {
  readonly key: string;
  readonly contentType: string;
  readonly body: string | Uint8Array;
}

export interface ObjectStoragePort {
  createUploadUrl(input: ObjectStorageUpload): Promise<string>;
  createDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  putObject(input: ObjectStoragePut): Promise<void>;
}

export interface S3ObjectStorageOptions {
  /** Docker/private address used only by server-side calls. */
  readonly internalEndpoint?: string;
  /** HTTPS address embedded into presigned URLs returned to browsers. */
  readonly publicEndpoint?: string;
  /** @deprecated Use internalEndpoint and publicEndpoint instead. */
  readonly endpoint?: string;
  readonly region?: string;
  readonly bucket: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly forcePathStyle?: boolean;
}

export class S3ObjectStorage implements ObjectStoragePort {
  private readonly internalClient: S3Client;
  private readonly publicClient: S3Client;

  constructor(private readonly options: S3ObjectStorageOptions) {
    const createClient = (endpoint: string | undefined) => new S3Client({
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

    // A presigned URL is consumed by a browser, so it must contain a public
    // hostname. Server-side writes stay on the private Docker network.
    this.internalClient = createClient(
      options.internalEndpoint ?? options.endpoint ?? options.publicEndpoint,
    );
    this.publicClient = createClient(
      options.publicEndpoint ?? options.endpoint ?? options.internalEndpoint,
    );
  }

  createUploadUrl(input: ObjectStorageUpload): Promise<string> {
    return getSignedUrl(
      this.publicClient,
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: input.key,
        ContentType: input.contentType,
      }),
      { expiresIn: input.expiresInSeconds ?? 300 },
    );
  }

  createDownloadUrl(key: string, expiresInSeconds = 300): Promise<string> {
    return getSignedUrl(
      this.publicClient,
      new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  async putObject(input: ObjectStoragePut): Promise<void> {
    await this.internalClient.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: input.key,
        ContentType: input.contentType,
        Body: input.body,
      }),
    );
  }
}
