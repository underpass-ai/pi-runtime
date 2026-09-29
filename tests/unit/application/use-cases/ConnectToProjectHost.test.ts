import { test } from "node:test";
import assert from "node:assert/strict";
import { ConnectToProjectHost } from "../../../../src/application/use-cases/ConnectToProjectHost.ts";
import { Project } from "../../../../src/domain/project/Project.ts";
import { ProjectRoot } from "../../../../src/domain/project/ProjectRoot.ts";

const project = Project.of(ProjectRoot.of("/repo"));
const gateway = { catalog: async () => { throw new Error(); }, call: async () => ({ structured: null, text: "" }), health: async () => ({ project: "/repo", started: [] }), close: () => {} };

test("conecta sin lanzar si el host ya escucha", async () => {
  let launches = 0;
  const uc = new ConnectToProjectHost({ locate: () => project }, async () => gateway, () => "/s", { launch: () => { launches++; } });
  assert.equal(await uc.execute("/repo/sub"), gateway);
  assert.equal(launches, 0);
});

test("lanza el host y reintenta si no hay nadie escuchando", async () => {
  let launches = 0; let attempts = 0;
  const connect = async (_s: string, retries: number) => { attempts++; if (retries === 0) throw new Error("ENOENT"); return gateway; };
  const uc = new ConnectToProjectHost({ locate: () => project }, connect, () => "/s", { launch: (p) => { launches++; assert.ok(p.id.equals(project.id)); } });
  assert.equal(await uc.execute("/repo"), gateway);
  assert.deepEqual([launches, attempts], [1, 2]);
});
