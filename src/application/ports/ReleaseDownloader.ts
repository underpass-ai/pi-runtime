export interface ReleaseDownloader { download(url: URL, to: string): Promise<void>; }
