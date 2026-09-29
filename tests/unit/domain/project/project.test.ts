import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ProjectRoot } from "../../../../src/domain/project/ProjectRoot.ts";
import { ProjectId } from "../../../../src/domain/project/ProjectId.ts";
import { Project } from "../../../../src/domain/project/Project.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

test("proyecto: raíz absoluta e id derivado", () => {
  const p = Project.of(ProjectRoot.of("/repo"));
  assert.equal(p.id.value, createHash("sha256").update("/repo").digest("hex").slice(0, 16));
  assert.ok(ProjectId.derive(ProjectRoot.of("/repo")).equals(p.id));
  assert.throws(() => ProjectRoot.of("repo"), DomainError);
  assert.throws(() => ProjectId.of("xyz"), DomainError);
});
