#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { ShrinkwrapMapper } from "../src/application/mappers/ShrinkwrapMapper.ts";
import { AuditDependencyTree } from "../src/application/use-cases/AuditDependencyTree.ts";
import { OsvVulnerabilityDatabase } from "../src/adapters/outbound/osv/OsvVulnerabilityDatabase.ts";

const file = process.argv[2];
if (!file) { console.error("usage: osv-audit <npm-shrinkwrap.json>"); process.exit(2); }
try {
  const coords = new ShrinkwrapMapper().toCoordinates(JSON.parse(readFileSync(file, "utf8")));
  const report = await new AuditDependencyTree(new OsvVulnerabilityDatabase()).execute(coords);
  console.log(JSON.stringify({ audited: report.audited, findings: report.findings().map((f) => ({ package: f.coordinate.key(), advisories: f.advisories.map(String) })) }, null, 2));
  process.exit(report.isClean() ? 0 : 1);
} catch (e) { console.error(String(e)); process.exit(2); }
