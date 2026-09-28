export type MadeCapabilitiesDto = {
  schema_version?: string; server?: { version?: string }; tool_count?: number;
  capabilities?: { id: string }[]; declared_limits?: { id: string }[]; host_activation?: { adapter: string } | null;
};
