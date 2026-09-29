import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ExtensionComposition } from "../../../../composition/ExtensionComposition.ts";

export default (pi: ExtensionAPI) => ExtensionComposition.host(pi as never);
