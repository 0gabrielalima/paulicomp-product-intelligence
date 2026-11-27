// Ponto de entrada independente da pasta atual: muda para a raiz do projeto antes de carregar .env e o servidor.
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
// Confia tambem nos certificados instalados no Windows (redes/antivirus que inspecionam HTTPS)
try { tls.setDefaultCACertificates([...new Set([...tls.getCACertificates("default"), ...tls.getCACertificates("system")])]); }
catch (e) { console.warn("[tls] Não foi possível carregar certificados do sistema:", (e as Error).message); }
await import("./index.ts");
