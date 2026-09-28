import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReleaseDownloader } from "../../../application/ports/ReleaseDownloader.ts";

export class GithubReleaseDownloader implements ReleaseDownloader {
  async download(url: URL, to: string): Promise<void> {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok || !res.body) throw new Error(`download failed ${res.status} ${url.href}`);
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(to));
  }
}
