#!/usr/bin/env node
// Receptor OTLP/HTTP JSON de prueba para la aceptación de O1: guarda cada POST en
// <dir>/<n>-<traces|metrics>.json y responde 200. En consola, sólo tamaños y NOMBRES de cabeceras.
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const [dir, port = "4318"] = process.argv.slice(2);
if (!dir) { console.error("usage: node tests/acceptance/otlp-receiver.ts <dir> [port]"); process.exit(2); }
mkdirSync(dir, { recursive: true });
let n = 0;
createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    const signal = req.url === "/v1/traces" ? "traces" : req.url === "/v1/metrics" ? "metrics" : "other";
    n++;
    writeFileSync(join(dir, `${String(n).padStart(4, "0")}-${signal}.json`), body);
    console.log(`${n} ${signal} ${body.length} bytes content-type=${req.headers["content-type"]} headers=${Object.keys(req.headers).sort().join(",")}`);
    res.writeHead(signal === "other" ? 404 : 200, { "content-type": "application/json" }).end("{}");
  });
}).listen(Number(port), "127.0.0.1", () => console.log(`otlp receiver on 127.0.0.1:${port} -> ${dir}`));
