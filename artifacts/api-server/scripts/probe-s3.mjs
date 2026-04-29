import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: "us-east-1",
  endpoint: process.env.POLYGON_S3_ENDPOINT ?? "https://files.massive.com",
  credentials: {
    accessKeyId: process.env.POLYGON_S3_ACCESS_KEY ?? "",
    secretAccessKey: process.env.POLYGON_S3_SECRET_KEY ?? "",
  },
  forcePathStyle: true,
});

const bucket = process.env.POLYGON_S3_BUCKET ?? "flatfiles";

async function list(prefix, delim) {
  console.log(`\n--- LIST prefix="${prefix}" delim="${delim ?? '(none)'}"`);
  try {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: bucket, Prefix: prefix, Delimiter: delim, MaxKeys: 50,
    }));
    if (res.CommonPrefixes?.length) {
      console.log("  CommonPrefixes:");
      for (const p of res.CommonPrefixes) console.log("    -", p.Prefix);
    }
    if (res.Contents?.length) {
      console.log(`  Contents (${res.Contents.length}):`);
      for (const o of res.Contents.slice(0, 10)) console.log(`    - ${o.Key}  (${o.Size}b)`);
    }
    if (!res.CommonPrefixes?.length && !res.Contents?.length) console.log("  (empty)");
  } catch (e) {
    let raw = "";
    const body = e.$response?.body;
    if (body) {
      const chunks = [];
      for await (const c of body) chunks.push(Buffer.from(c));
      raw = Buffer.concat(chunks).toString("utf8").slice(0, 500);
    }
    console.log("  ERR:", e.name, e.message, raw ? `raw=${raw}` : "");
  }
}

await list("", "/");
await list("us_options_opra/", "/");
await list("us_options_opra/day_aggs_v1/", "/");
await list("us_options_opra/day_aggs_v1/2026/", "/");
await list("us_options_opra/day_aggs_v1/2026/04/", "/");
await list("us_options_opra/day_aggs_v1/2026/04/17/", "/");
await list("us_options_opra/day_aggs_v1/2026/04/17/", undefined);
