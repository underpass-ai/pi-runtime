#!/usr/bin/env node
// Uso: MADE_SETUP_CONFIG_ROOT=<dir> XDG_STATE_HOME=<dir> node tests/acceptance/made-config.ts
//
// Prepara MADE para una aceptación aislada en un XDG_STATE_HOME y un
// MADE_SETUP_CONFIG_ROOT temporales: crea (si falta) la configuración privada
// del store que resuelve el entorno y siembra su política de autorización con
// el binario fijado, como hace `underpass setup` (EnsureMadeConfiguration y
// BootstrapMadeAuthorization), sin el resto de setup: ni descarga binarios ni
// toca la instalación de Pi. Nunca imprime los valores de la configuración.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { EnsureMadeConfiguration } from "../../src/application/use-cases/EnsureMadeConfiguration.ts";
import { BootstrapMadeAuthorization } from "../../src/application/use-cases/BootstrapMadeAuthorization.ts";
import { FsMadeConfigurationRepository } from "../../src/adapters/outbound/fs/FsMadeConfigurationRepository.ts";
import { FsBinaryInstallation } from "../../src/adapters/outbound/fs/FsBinaryInstallation.ts";
import { JsonPinSetSource } from "../../src/adapters/outbound/fs/JsonPinSetSource.ts";
import { MadeCliAuthorizationBootstrapper } from "../../src/adapters/outbound/process/MadeCliAuthorizationBootstrapper.ts";
import { NodeEntropySource } from "../../src/adapters/outbound/crypto/NodeEntropySource.ts";
import { BinaryName } from "../../src/domain/distribution/BinaryName.ts";
import { RepoFile } from "../../src/composition/RepoFile.ts";
import { StatePaths } from "../../src/composition/StatePaths.ts";

if (!process.env.MADE_SETUP_CONFIG_ROOT || !process.env.XDG_STATE_HOME) {
  console.error("set MADE_SETUP_CONFIG_ROOT and XDG_STATE_HOME to throwaway directories");
  process.exit(2);
}
const paths = new StatePaths(process.env);
const store = paths.madeStore();
mkdirSync(dirname(store.value), { recursive: true, mode: 0o700 });
const { configuration, created } = new EnsureMadeConfiguration(new FsMadeConfigurationRepository(paths.madeConfigRoot()), new NodeEntropySource()).execute(store);
console.log(created ? "made config created" : "made config already present");
const pins = new JsonPinSetSource(RepoFile.path("pins.json")).load();
const binary = new FsBinaryInstallation(paths.binDir()).pathOf(pins.pinFor(BinaryName.MADE));
const check = await new BootstrapMadeAuthorization(new MadeCliAuthorizationBootstrapper(binary)).execute(store, configuration);
// Sólo el estado: el detalle de made-mcp puede citar los ids de la política.
console.log(`authorization bootstrap ${check.status.value}`);
process.exit(check.status.value === "FAIL" ? 1 : 0);
