// Cliente HTTP para SUR/AUI. Se ejecuta dentro de una Pages Function:
// las credenciales nunca salen al navegador.

export const BASE = 'https://suraui.sanluis.gov.ar/AsistenciaWeb/Admin/';
export const SECTOR_ID = '120';
export const SECTOR_NOMBRE = 'Sop.Terrazas//ExCDG//Mater//Pediátrico';
export const UA = 'Mozilla/5.0 (compatible; BandejaAUI/1.0)';

const ENTIDADES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&aacute;': 'á', '&eacute;': 'é',
  '&iacute;': 'í', '&oacute;': 'ó', '&uacute;': 'ú', '&ntilde;': 'ñ',
  '&Aacute;': 'Á', '&Eacute;': 'É', '&Iacute;': 'Í', '&Oacute;': 'Ó',
  '&Uacute;': 'Ú', '&Ntilde;': 'Ñ'
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

export function autorizado(request, env) {
  const pin = request.headers.get('x-app-pin') || '';
  if (!env.APP_PIN || pin !== env.APP_PIN) {
    return json({ error: 'PIN incorrecto' }, 401);
  }
  return null;
}

export function clean(value) {
  let s = String(value || '');
  s = s.replace(/<[^>]*>/g, ' ');
  s = s.replace(/&(?:#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m) => {
    if (/^&#\d+$/.test(m)) {
      return String.fromCharCode(parseInt(m.slice(2), 10));
    }
    if (/^&#x/i.test(m)) {
      return String.fromCharCode(parseInt(m.slice(3), 16));
    }
    return ENTIDADES[m.toLowerCase()] || ENTIDADES[m] || m;
  });
  return s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function login(env) {
  if (!env.SUR_USER || !env.SUR_PASS) {
    throw new Error('Faltan los secretos SUR_USER / SUR_PASS');
  }
  const body = new URLSearchParams({
    UsuarioCodigo: env.SUR_USER,
    UsuarioPassword: env.SUR_PASS,
    submit1: 'Ingresar',
    PageFrom: ''
  });
  const res = await fetch(BASE + 'Seguridad/ExecUsuarioLogin.asp', {
    method: 'POST',
    body,
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': UA
    }
  });
  const raw = res.headers.getSetCookie
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie') || ''];
  const cookie = raw.map((v) => v.split(';')[0]).filter(Boolean).join('; ');
  if (!cookie) throw new Error('SUR/AUI no devolvió sesión (login rechazado)');
  return cookie;
}

export async function getPage(url, cookie) {
  const res = await fetch(url, {
    headers: { cookie, 'user-agent': UA },
    redirect: 'follow'
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' al consultar SUR/AUI');
  const buffer = await res.arrayBuffer();
  // La web declara charset=iso-8859-1.
  return new TextDecoder('iso-8859-1').decode(buffer);
}

function celdas(tr) {
  const parts = tr.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi) || [];
  return parts.map((p) => clean(p.replace(/^<t[dh]\b[^>]*>/i, '').replace(/<\/t[dh]>$/i, '')));
}

export function parsearListado(html) {
  const totalMatch = html.match(/Cantidad de Reclamos encontrados:\s*([\d.]+)/i);
  const total = totalMatch ? Number(totalMatch[1].replace(/\./g, '')) : 0;
  const trs = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  const tickets = [];
  for (const tr of trs) {
    if (!/ReclamoVer\.asp\?ReclamoId=(\d+)/i.test(tr)) continue;
    const c = celdas(tr);
    if (c.length < 15 || !/^\d+$/.test(c[0])) continue;
    tickets.push({
      id: c[0],
      fecha: c[1] || '',
      reclamante: c[2] || '',
      estado: c[3] || '',
      institucion: c[6] || '',
      bloqueador: c[7] || '',
      motivo: c[8] || '',
      sector: c[9] || '',
      localidad: c[10] || '',
      prioridad: c[14] || '',
      ingreso: c[15] || '',
      procedimiento: c[17] || ''
    });
  }
  return { total, tickets };
}

function campo(html, etiqueta) {
  const re = new RegExp(etiqueta + '\\s*:\\s*(?:&nbsp;\\s*)?<\\/td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>', 'i');
  const m = html.match(re);
  return m ? clean(m[1]) : '';
}

export function parsearDetalle(html) {
  const desc = html.match(/<textarea\b[^>]*\bname\s*=\s*"?textarea1"?[^>]*>([\s\S]*?)<\/textarea>/i);
  const comentarios = [];
  const seccion = html.match(/<div\b[^>]*\bid\s*=\s*"?Comentarios"?[^>]*>([\s\S]*?)<\/div>/i);
  if (seccion) {
    const trs = seccion[1].match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
    for (const tr of trs) {
      const c = celdas(tr);
      if (c.length >= 4 && /^\d{2}\/\d{2}\/\d{4}$/.test(c[0] || '')) {
        comentarios.push({ fecha: c[0], autor: c[2] || '', texto: c[3] || '' });
      }
    }
  }
  return {
    organismo: campo(html, 'Organismo'),
    institucion: campo(html, '(?:Institución|Institucion)'),
    titulo: campo(html, '(?:Título|Titulo)'),
    descripcion: desc ? clean(desc[1]) : '',
    comentarios: comentarios.slice(-3).reverse()
  };
}

export function inferirSitio(t) {
  const texto = [t.descripcion, t.titulo, t.institucion, t.organismo, t.motivo].join(' ');
  if (/terrazas/i.test(texto)) return 'Terrazas del Portezuelo';
  if (/casa de gobierno|excdg/i.test(texto)) return 'Ex Casa de Gobierno';
  if (/cerpre|rehabilitaci[oó]n|policl[ií]nic/i.test(texto)) return 'Policlínico';
  if (/pedi[aá]tric/i.test(texto)) return 'Hospital Pediátrico';
  if (/\bmater\b/i.test(texto)) return 'Mater';
  return 'Sin identificar';
}

export async function obtenerBandeja(env) {
  const cookie = await login(env);
  const html = await getPage(
    BASE + 'AUI/ReclamoABM.asp?ReclamoEstadoID=-1&SectorId=' + SECTOR_ID + '&submit1=Consultar',
    cookie
  );
  const listado = parsearListado(html);
  const tickets = await Promise.all(listado.tickets.map(async (t) => {
    const detalleHtml = await getPage(BASE + 'AUI/ReclamoVer.asp?ReclamoId=' + t.id, cookie);
    const detalle = parsearDetalle(detalleHtml);
    const merged = { ...t };
    for (const [clave, valor] of Object.entries(detalle)) {
      if (valor !== '' && valor != null) merged[clave] = valor;
    }
    return { ...merged, sitio: inferirSitio(merged) };
  }));
  const conteo = {};
  for (const t of tickets) conteo[t.sitio] = (conteo[t.sitio] || 0) + 1;
  return {
    generado: new Date().toISOString(),
    filtro: { estado: 'No Cerrados', sector: SECTOR_NOMBRE },
    total: tickets.length,
    sitios: Object.entries(conteo)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([nombre, cantidad]) => ({ nombre, cantidad })),
    tickets
  };
}
