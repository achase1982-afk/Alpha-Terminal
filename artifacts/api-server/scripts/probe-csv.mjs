import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { createGunzip } from "zlib";
import { createInterface } from "readline";

const s3 = new S3Client({
  region: "us-east-1",
  endpoint: process.env.POLYGON_S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.POLYGON_S3_ACCESS_KEY,
    secretAccessKey: process.env.POLYGON_S3_SECRET_KEY,
  },
  forcePathStyle: true,
});

const key = "us_options_opra/day_aggs_v1/2026/04/2026-04-17.csv.gz";
const res = await s3.send(new GetObjectCommand({ Bucket: "flatfiles", Key: key }));
const rl = createInterface({ input: res.Body.pipe(createGunzip()), crlfDelay: Infinity });
let n = 0;
for await (const line of rl) {
  console.log(line);
  if (++n >= 5) break;
}
console.log(`(showing first ${n} lines)`);
