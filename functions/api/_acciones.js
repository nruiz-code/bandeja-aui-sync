// Ejecución de acciones contra SUR/AUI. Se usa desde el sincronizador local,
// porque Cloudflare no puede alcanzar el servidor de SUR/AUI (devuelve 522).

import { BASE, clean, getPage, login } from './_sur.js';

export const ACCIONES = {
  validar:     { codigo: 2,  etiqueta: 'Validar' },
  bloquear:    { codigo: 3,  etiqueta: 'Bloquear' },
  tomar:       { codigo: 4,  etiqueta: 'Tomar' },
  cerrar:      { codigo: 5,  etiqueta: 'Cerrar' },
  desbloquear: { codigo: 6,  etiqueta: 'Desbloquear' },
  actualizar:  { codigo: 7,  etiqueta: 'Actualizar' },
  desbloquearAjeno: { codigo: 9, etiqueta: 'Desbloquear (ajeno)' },
  gestionar:   { codigo: 12, etiqueta: 'Gestionar' }
};

function attr(tag, name) {
  const m = tag.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i'));
  if (m) return m[1];
  const s = tag.match(new RegExp(name + "\\s*=\\s*'([^']*)'", 'i'));
  return s ? s[1] : '';
}

export function camposDelFormulario(html, reclamoId, codigo, solucion) {
  const inicio = html.search(/<form\b[^>]*name="Reclamo"[^>]*>/i);
  if (inicio < 0) throw new Error('No se encontró el formulario del reclamo');
  const fin = html.indexOf('</form>', inicio);
  const form = html.slice(inicio, fin > 0 ? fin : inicio + 20000);
  const datos = new URLSearchParams();

  for (const tag of form.match(/<input\b[^>]*>/gi) || []) {
    const name = attr(tag, 'name');
    const type = (attr(tag, 'type') || 'text').toLowerCase();
    if (!name || ['button', 'submit', 'reset', 'image', 'file'].includes(type)) continue;
    if ((type === 'checkbox' || type === 'radio') && !/\bchecked\b/i.test(tag)) continue;
    datos.set(name, attr(tag, 'value'));
  }
  for (const tag of form.match(/<textarea\b[^>]*>([\s\S]*?)<\/textarea>/gi) || []) {
    const name = attr(tag, 'name');
    if (!name) continue;
    const valor = tag.replace(/^<textarea\b[^>]*>/i, '').replace(/<\/textarea>$/i, '');
    datos.set(name, clean(valor));
  }
  for (const tag of form.match(/<select\b[^>]*>[\s\S]*?<\/select>/gi) || []) {
    const name = attr(tag, 'name');
    if (!name) continue;
    const options = tag.match(/<option\b[^>]*>[\s\S]*?<\/option>/gi) || [];
    const elegida = options.find((o) => /\bselected\b/i.test(o)) || options[0];
    datos.set(name, elegida ? attr(elegida, 'value') : '');
  }

  datos.set('Accion', String(codigo));
  datos.set('ReclamoId', String(reclamoId));
  if (solucion) datos.set('ReclamoMensajeCierre', solucion);
  return datos;
}

export function estadoDelDetalle(html) {
  const m = html.match(/Estado\s*:\s*(?:&nbsp;\s*)?<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
  return m ? clean(m[1]) : '';
}

export async function ejecutarAccionSur(env, { id, accion, solucion = '' }) {
  const reclamoId = String(id || '').trim();
  const nombre = String(accion || '').trim();
  const texto = String(solucion || '').trim();
  const accionCfg = ACCIONES[nombre];

  if (!/^\d{4,12}$/.test(reclamoId)) throw new Error('ID de reclamo inválido');
  if (!accionCfg) throw new Error('Acción no permitida');
  if (nombre === 'cerrar' && !texto) throw new Error('Para cerrar hay que completar la solución');

  const cookie = await login(env);
  const urlDetalle = BASE + 'AUI/ReclamoVer.asp?ReclamoId=' + reclamoId;
  const detalle = await getPage(urlDetalle, cookie);
  if (!/Datos del Reclamo Nro/.test(detalle)) throw new Error('No se encontró el reclamo ' + reclamoId);

  const estadoAnterior = estadoDelDetalle(detalle);
  const datos = camposDelFormulario(detalle, reclamoId, accionCfg.codigo, texto);
  const res = await fetch(BASE + 'AUI/ReclamoExec.asp', {
    method: 'POST',
    body: datos,
    redirect: 'follow',
    headers: {
      cookie,
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'Mozilla/5.0 (compatible; BandejaAUI/1.0)',
      referer: urlDetalle
    }
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' al ejecutar la acción');

  const nuevo = await getPage(urlDetalle, cookie);
  const estadoNuevo = estadoDelDetalle(nuevo);
  return {
    reclamoId,
    accion: accionCfg.etiqueta,
    estadoAnterior,
    estadoNuevo,
    mensaje: estadoNuevo && estadoNuevo !== estadoAnterior
      ? 'Estado actualizado a ' + estadoNuevo
      : 'Acción enviada. Verificá el resultado en SUR/AUI.'
  };
}
