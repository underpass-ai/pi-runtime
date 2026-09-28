import { test } from "node:test";
import assert from "node:assert/strict";
import { StatePaths } from "../../../src/composition/StatePaths.ts";
import { Project } from "../../../src/domain/project/Project.ts";
import { ProjectRoot } from "../../../src/domain/project/ProjectRoot.ts";

test("rutas de estado bajo XDG y fuera del proyecto", () => {
  const p = Project.of(ProjectRoot.of("/repo"));
  const s = new StatePaths({ HOME: "/h" });
  assert.equal(s.root(), "/h/.local/state/underpass-pi");
  assert.equal(s.socketOf(p), `/h/.local/state/underpass-pi/projects/${p.id}/host.sock`);
  assert.equal(s.binDir(), "/h/.local/share/underpass-pi/bin");
  assert.equal(new StatePaths({ HOME: "/h", XDG_STATE_HOME: "/s", XDG_DATA_HOME: "/d" }).fingerprintsFile(), "/s/underpass-pi/fingerprints.json");
  assert.equal(new StatePaths({ HOME: "/h", XDG_DATA_HOME: "/d" }).binDir(), "/d/underpass-pi/bin");
});
