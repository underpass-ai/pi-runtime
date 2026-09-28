import { test } from "node:test";
import assert from "node:assert/strict";
import { LineFramer } from "../../../../src/adapters/ipc/LineFramer.ts";

test("un carácter UTF-8 de 2 bytes partido entre chunks se decodifica bien", () => {
  const lines: string[] = [];
  const framer = new LineFramer((l) => lines.push(l), () => {});
  const buf = Buffer.from("ñ\n", "utf8"); // 2 bytes for ñ + newline
  framer.push(buf.subarray(0, 1));
  framer.push(buf.subarray(1));
  assert.deepEqual(lines, ["ñ"]);
});

test("un carácter UTF-8 de 4 bytes (emoji) partido entre chunks se decodifica bien", () => {
  const lines: string[] = [];
  const framer = new LineFramer((l) => lines.push(l), () => {});
  const buf = Buffer.from("😀\n", "utf8"); // 4 bytes
  framer.push(buf.subarray(0, 2));
  framer.push(buf.subarray(2));
  assert.deepEqual(lines, ["😀"]);
});

test("varias líneas en un solo chunk se separan todas", () => {
  const lines: string[] = [];
  const framer = new LineFramer((l) => lines.push(l), () => {});
  framer.push(Buffer.from("uno\ndos\ntres\n", "utf8"));
  assert.deepEqual(lines, ["uno", "dos", "tres"]);
});

test("una línea final parcial se conserva hasta que llega su salto de línea", () => {
  const lines: string[] = [];
  const framer = new LineFramer((l) => lines.push(l), () => {});
  framer.push(Buffer.from("primero\nresto-sin-nl", "utf8"));
  assert.deepEqual(lines, ["primero"]);
  framer.push(Buffer.from("-completado\n", "utf8"));
  assert.deepEqual(lines, ["primero", "resto-sin-nl-completado"]);
});

test("el desbordamiento del buffer pendiente dispara onOverflow", () => {
  let overflowed = false;
  const framer = new LineFramer(() => {}, () => { overflowed = true; });
  framer.push(Buffer.from("a".repeat(16 * 1024 * 1024 + 1), "utf8"));
  assert.equal(overflowed, true);
});
