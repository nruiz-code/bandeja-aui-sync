// Sincronizador local: corre en la PC del usuario (donde SUR/AUI sí es alcance).
// 1) ejecuta las acciones encoladas desde la app, 2) actualiza el snapshot en Cloudflare KV.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { obtenerBandeja } from './functions/api/_sur.js';
import { ejecutarAccionSur } from './functions/api/_acciones.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MAX_COMANDOS_POR_CORRIDA = 20;

function leerEnv() {
  const archivo = path.join(ROOT, '.env');
  const salida = {};
  if (!fs.existsSync(archivo)) return salida;
  for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) salida[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return salida;
}

function wrangler(args) {
  const npxPath = path.join(path.dirname(process.execPath), process.platform === 'win32' ? 'npx.cmd' : 'npx');
  const comando = process.platform === 'win32' ? `"${npxPath}" ${args.join(' ')}` : `${npxPath} ${args.join(' ')}`;
  const r = spawnSync(comando, { cwd: ROOT, shell: true, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || '').trim().slice(-500) || 'wrangler falló');
  }
  return r.stdout || '';
}

function kvGet(key) {
  try {
    const out = wrangler(['wrangler', 'kv', 'key', 'get', key, '--binding', 'BANDEJA_AUI', '--remote']).trim();
    return out ? JSON.parse(out) : null;
  } catch (error) {
    if (/404|Not Found|does not exist|no such/i.test(error.message)) return null;
    throw error;
  }
}

function kvPut(key, valor) {
  const tmp = path.join(os.tmpdir(), `aui-${key}-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify(valor), 'utf8');
  try {
    wrangler(['wrangler', 'kv', 'key', 'put', key, '--path', tmp, '--binding', 'BANDEJA_AUI', '--remote']);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

async function main() {
  const lock = path.join(os.tmpdir(), 'bandeja-aui-sync.lock');
  if (fs.existsSync(lock) && Date.now() - fs.statSync(lock).mtimeMs < 5 * 60 * 1000) {
    console.log('Ya hay una sincronización reciente. Salgo.');
    return;
  }
  fs.writeFileSync(lock, String(process.pid));

  const env = { ...process.env, ...leerEnv() };
  const errores = [];

  try {
    // 1) Acciones pendientes
    const comandos = (await Promise.resolve(kvGet('comandos'))) || [];
    const pendientes = comandos.filter((c) => c.estado === 'pendiente').slice(0, MAX_COMANDOS_POR_CORRIDA);
    for (const cmd of pendientes) {
      try {
        const resultado = await ejecutarAccionSur(env, cmd);
        cmd.estado = 'ok';
        cmd.resultado = resultado;
        cmd.ejecutado = new Date().toISOString();
        console.log(`Acción ${cmd.id} (${cmd.accion}): ${resultado.mensaje}`);
      } catch (error) {
        cmd.estado = 'error';
        cmd.error = error.message;
        cmd.ejecutado = new Date().toISOString();
        errores.push(`Acción ${cmd.id}: ${error.message}`);
        console.error(`Acción ${cmd.id} falló: ${error.message}`);
      }
    }
    if (pendientes.length) kvPut('comandos', comandos);

    // 2) Snapshot de la bandeja
    const datos = await obtenerBandeja(env);
    kvPut('snapshot', {
      generado: datos.generado,
      filtro: datos.filtro,
      total: datos.total,
      sitios: datos.sitios,
      tickets: datos.tickets
    });

    kvPut('sync', {
      ultima: new Date().toISOString(),
      total: datos.total,
      sitios: datos.sitios,
      accionesEjecutadas: pendientes.length,
      error: errores.length ? errores.join(' | ') : null
    });

    console.log(`OK ${new Date().toISOString()} · ${datos.total} reclamos · ${pendientes.length} acciones procesadas`);
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

main().catch((error) => {
  console.error('ERROR DE SINCRONIZACIÓN:', error.message);
  try {
    kvPut('sync', { ultima: new Date().toISOString(), error: error.message });
  } catch (_) { /* no se pudo registrar */ }
  process.exitCode = 1;
});
