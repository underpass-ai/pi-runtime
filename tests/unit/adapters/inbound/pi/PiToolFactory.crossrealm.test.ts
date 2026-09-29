import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { PiToolFactory } from "../../../../../src/adapters/inbound/pi/PiToolFactory.ts";
import { HostCallError } from "../../../../../src/application/ports/HostCallError.ts";
import { McpToolMapper } from "../../../../../src/application/mappers/McpToolMapper.ts";
import { ServerName } from "../../../../../src/domain/mcp/ServerName.ts";

// Pi carga cada fichero de extensión con jiti en un realm propio
// (moduleCache: false): el HostCallError que lanza el gateway (creado en el
// realm de host.ts) no es la misma clase que ve PiToolFactory en kmp.ts o
// made.ts, así que `instanceof` falla. Lo reproducimos importando la clase
// de error con un query de cache-busting, que Node evalúa como otro módulo.
test("una negativa del host conserva kind y code aunque el error venga de otro realm", async () => {
  const url = pathToFileURL(new URL("../../../../../src/application/ports/HostCallError.ts", import.meta.url).pathname).href;
  const foreign = (await import(`${url}?realm=host`)).HostCallError as typeof HostCallError;
  assert.notEqual(foreign, HostCallError, "el test no probaría nada si Node reutilizase el mismo módulo");

  const gateway = async () => ({
    catalog: async () => { throw new Error("n/a"); },
    call: async () => { throw new foreign("refused", "nope", "invalid_argument"); },
    health: async () => ({ project: "", started: [] }),
    close: () => {},
    onClose: () => {},
  });
  const descriptor = new McpToolMapper().toDomain({ name: "kmp_ingest", inputSchema: { type: "object" } });
  const tool = new PiToolFactory((j) => j).create(ServerName.KMP, descriptor, gateway);
  await assert.rejects(tool.execute("c", {}), (e: Error) => e.message === "kmp_ingest refused (invalid_argument): nope");
});

test("un error cualquiera sin forma de HostCallError se propaga intacto", async () => {
  const boom = new Error("boom");
  const gateway = async () => ({
    catalog: async () => { throw new Error("n/a"); },
    call: async () => { throw boom; },
    health: async () => ({ project: "", started: [] }),
    close: () => {},
    onClose: () => {},
  });
  const descriptor = new McpToolMapper().toDomain({ name: "kmp_ask", inputSchema: { type: "object" } });
  const tool = new PiToolFactory((j) => j).create(ServerName.KMP, descriptor, gateway);
  await assert.rejects(tool.execute("c", {}), (e) => e === boom);
});

test("HostCallError.is reconoce la forma, no la clase", () => {
  assert.equal(HostCallError.is(new HostCallError("transport", "x")), true);
  assert.equal(HostCallError.is({ name: "HostCallError", kind: "refused", message: "m" }), true);
  assert.equal(HostCallError.is({ name: "HostCallError", message: "m" }), false);
  assert.equal(HostCallError.is(new Error("x")), false);
  assert.equal(HostCallError.is(null), false);
  assert.equal(HostCallError.is("HostCallError"), false);
});
