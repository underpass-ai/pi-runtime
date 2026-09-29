#!/usr/bin/env node
// Uso: MADE_SETUP_CONFIG_ROOT=<dir> XDG_STATE_HOME=<dir> node tests/acceptance/made-config.ts
//
// Crea (si falta) la configuración privada de MADE para el store que resuelven
// las variables del entorno, como hace `underpass setup` con EnsureMadeConfiguration,
// sin el resto de setup (no toca la instalación de Pi). Sirve para aislar una
// aceptación en un XDG_STATE_HOME y un MADE_SETUP_CONFIG_ROOT temporales.
// Sólo imprime si se creó; nunca los valores.
import { EnsureMadeConfiguration } from "../../src/application/use-cases/EnsureMadeConfiguration.ts";
import { FsMadeConfigurationRepository } from "../../src/adapters/outbound/fs/FsMadeConfigurationRepository.ts";
import { NodeEntropySource } from "../../src/adapters/outbound/crypto/NodeEntropySource.ts";
import { StatePaths } from "../../src/composition/StatePaths.ts";

if (!process.env.MADE_SETUP_CONFIG_ROOT || !process.env.XDG_STATE_HOME) {
  console.error("set MADE_SETUP_CONFIG_ROOT and XDG_STATE_HOME to throwaway directories");
  process.exit(2);
}
const paths = new StatePaths(process.env);
const { created } = new EnsureMadeConfiguration(new FsMadeConfigurationRepository(paths.madeConfigRoot()), new NodeEntropySource()).execute(paths.madeStore());
console.log(created ? "made config created" : "made config already present");
