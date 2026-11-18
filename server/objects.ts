import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

export function objectStorage(env: NodeJS.ProcessEnv) {
  if (!env.S3_BUCKET) return null;
  const client = new S3Client({
    region: env.AWS_REGION || "us-east-1",
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle: env.S3_PATH_STYLE === "true",
  });
  return {
    async put(key: string, bytes: Buffer, type: string) {
      await client.send(
        new PutObjectCommand({
          Bucket: env.S3_BUCKET,
          Key: key,
          Body: bytes,
          ContentType: type,
          ServerSideEncryption: "AES256",
        }),
      );
    },
    async get(key: string) {
      return client.send(
        new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
      );
    },
    async remove(key: string) {
      await client.send(
        new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
      );
    },
  };
}
