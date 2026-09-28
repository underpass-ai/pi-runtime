export type PinSetDto = {
  pi: { package: string; version: string; integrity: string };
  binaries: { name: string; version: string; repo: string; sha256: Record<string, string> }[];
};
