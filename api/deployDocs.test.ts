import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Die Caddy-Konfiguration steht zweimal im Repo, und das ist Absicht:
 *
 * - `Caddyfile` — für alle, die das Repo auschecken.
 * - Als `configs`-Block in der README, für Oberflächen wie Portainer, die nur
 *   **ein** Compose-File entgegennehmen und keine Dateien daneben kennen.
 *
 * Zwei Kopien laufen früher oder später auseinander, und der Schaden wäre
 * leise: Portainer-Nutzer bekämen ein anderes Setup als alle anderen, ohne
 * dass irgendwo etwas rot wird. Dieser Test hält sie zusammen.
 */

const root = path.resolve(import.meta.dirname, "..");

/** Wirksame Zeilen einer Caddy-Konfiguration — ohne Kommentare und Einrückung */
function directives(text: string): string[] {
  return text
    .split("\n")
    .map(line => line.trim())
    .filter(line => line !== "" && !line.startsWith("#"))
    .map(line => line.replace(/\s+/g, " "));
}

/**
 * Den Inhalt des `content: |`-Blocks aus dem Portainer-Stack der README
 * herausziehen. Bewusst textuell und ohne YAML-Parser: Das Projekt hat keinen,
 * und für vier Direktiven eine Abhängigkeit aufzunehmen wäre unverhältnismäßig.
 */
function readmeCaddyfile(readme: string): string {
  const lines = readme.split("\n");
  const start = lines.findIndex(line => line.trim() === "content: |");
  expect(start, "content-Block in der README gefunden").toBeGreaterThan(-1);

  const indent = (lines[start].match(/^\s*/) ?? [""])[0].length;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    // Der Block endet bei der ersten Zeile, die nicht tiefer eingerückt ist
    if (
      line.trim() !== "" &&
      (line.match(/^\s*/) ?? [""])[0].length <= indent
    ) {
      break;
    }
    body.push(line);
  }
  // `$$` ist die Escape-Schreibweise von Compose; im Container kommt ein
  // einfaches `$` an — genau das, was auch im `Caddyfile` steht.
  return body.join("\n").replace(/\$\$/g, "$");
}

describe("Caddy-Konfiguration in Datei und README", () => {
  it("führt dieselben Direktiven", () => {
    const file = fs.readFileSync(path.join(root, "Caddyfile"), "utf-8");
    const readme = fs.readFileSync(path.join(root, "README.md"), "utf-8");

    const fromFile = directives(file);
    // Sicherheitsnetz gegen einen leeren Vergleich: Wäre `directives` kaputt,
    // liefen unten zwei leere Listen erfolgreich gegeneinander.
    expect(fromFile).toContain("reverse_proxy finance-fox:3000");

    expect(directives(readmeCaddyfile(readme))).toEqual(fromFile);
  });

  it("escapt den Platzhalter in der README, wie Compose es verlangt", () => {
    const readme = fs.readFileSync(path.join(root, "README.md"), "utf-8");
    const block = readme.slice(readme.indexOf("content: |"));
    const inline = block.slice(0, block.indexOf("\n\n"));
    // Ein einfaches `$` würde Compose selbst ersetzen — im Container stünde
    // dann `{192.168.1.10:localhost}` statt `{$FF_PUBLIC_HOST:localhost}`.
    expect(inline).toContain("{$$FF_PUBLIC_HOST:localhost}");
  });
});
