#!/usr/bin/env bash
# Excepción acotada aprobada (28 sept 2026): Pi y su árbol entran por npm, sin
# scripts de instalación, con el shrinkwrap publicado, integridad comprobada y
# auditoría OSV antes de exponer `pi`.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
pins="${here}/pins.json"
pkg="$(node -e 'console.log(require(process.argv[1]).pi.package)' "$pins")"
ver="$(node -e 'console.log(require(process.argv[1]).pi.version)' "$pins")"
want="$(node -e 'console.log(require(process.argv[1]).pi.integrity)' "$pins")"
prefix="${PI_RUNTIME_PREFIX:-${XDG_DATA_HOME:-$HOME/.local/share}/pi-runtime/pi-${ver}}"
staging="${prefix}.staging"

got="$(npm view "${pkg}@${ver}" dist.integrity)"
[[ "$got" == "$want" ]] || { echo "install-pi: integrity mismatch: $got" >&2; exit 1; }

rm -rf "$staging"
npm install -g --ignore-scripts --no-audit --no-fund --prefix "$staging" "${pkg}@${ver}"
shrink="${staging}/lib/node_modules/${pkg}/npm-shrinkwrap.json"
[[ -f "$shrink" ]] || { echo "install-pi: published shrinkwrap missing" >&2; exit 1; }
if node "${here}/bin/osv-audit.ts" "$shrink" > "${staging}/osv-audit.json" 2> "${staging}/osv-audit.err"; then
  audit_rc=0
else
  audit_rc=$?
fi
if [[ "$audit_rc" -eq 1 ]]; then
  echo "install-pi: OSV audit found vulnerabilities; see ${staging}/osv-audit.json" >&2; exit 1
elif [[ "$audit_rc" -ne 0 ]]; then
  echo "install-pi: OSV audit could not run (exit ${audit_rc}); nothing was installed; see ${staging}/osv-audit.err" >&2; exit 1
fi

rm -rf "$prefix" && mv "$staging" "$prefix"
mkdir -p "$HOME/.local/bin" && ln -sfn "${prefix}/bin/pi" "$HOME/.local/bin/pi"
echo "install-pi: ${pkg}@${ver} installed at ${prefix} (OSV clean)"
