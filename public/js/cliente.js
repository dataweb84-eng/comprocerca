function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const STORAGE_KEY = 'cc_ubicacion';
const BIENVENIDA_KEY = 'cc_bienvenida_vista';
const RADIO_ZONA_KM = 0.8; // ~8 cuadras
const RADIOS_FALLBACK = [RADIO_ZONA_KM, 2, null]; // null = sin límite

let mapa = null;
let ciudadSeleccionada = null;
let debounceCiudad = null;
let comerciosZona = [];
let yaHablo = false;

function guardarUbicacion(loc) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(loc));
}

function leerUbicacion() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function mostrar(id) {
  document.getElementById(id).classList.remove('oculto');
}
function ocultar(id) {
  document.getElementById(id).classList.add('oculto');
}

// --- Bienvenida (solo la primera vez) ---

function hablarBienvenida() {
  if (yaHablo) return;
  yaHablo = true;
  if (!('speechSynthesis' in window)) return;
  try {
    const mensaje =
      '¡Hola! Somos Compro Cerca. Estamos para darte esa comodidad que esperabas: nada de hacer cola. ' +
      'Armá tu pedido desde tu casa o el trabajo, en el comercio de confianza cerca tuyo. ¡Bienvenido!';
    const utter = new SpeechSynthesisUtterance(mensaje);
    utter.lang = 'es-AR';
    utter.rate = 1;
    utter.pitch = 1;
    const voces = window.speechSynthesis.getVoices();
    const voz =
      voces.find((v) => v.lang === 'es-AR') || voces.find((v) => v.lang && v.lang.startsWith('es'));
    if (voz) utter.voice = voz;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  } catch (e) { /* la voz es un extra: si falla, seguimos sin romper nada */ }
}

function mostrarBienvenida() {
  mostrar('bienvenida');
  // Algunos navegadores permiten hablar sin interacción previa; si no,
  // se reintenta con el click de "¡Empezar a pedir!".
  setTimeout(hablarBienvenida, 300);
}

function cerrarBienvenida() {
  hablarBienvenida();
  localStorage.setItem(BIENVENIDA_KEY, '1');
  document.getElementById('bienvenida').remove();
  iniciarUbicacion();
}

// --- Arranque ---

function init() {
  if (!localStorage.getItem(BIENVENIDA_KEY)) {
    mostrarBienvenida();
    return;
  }
  iniciarUbicacion();
}

function iniciarUbicacion() {
  const guardada = leerUbicacion();
  if (guardada) {
    mostrarResultados(guardada);
    return;
  }

  ocultar('estado-inicial');
  if (!navigator.geolocation) {
    mostrarPasoUbicacion();
    return;
  }

  mostrar('estado-inicial');
  navigator.geolocation.getCurrentPosition(
    (pos) => resolverPorGps(pos),
    () => {
      ocultar('estado-inicial');
      mostrarPasoUbicacion();
    },
    { timeout: 8000 }
  );
}

async function resolverPorGps(pos) {
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  let label = 'Tu ubicación actual';
  try {
    const r = await fetch(`/api/geo/ubicacion?lat=${lat}&lng=${lng}`);
    const data = await r.json();
    if (data.label) label = data.label;
  } catch (e) { /* seguimos con el label genérico */ }
  const loc = { lat, lng, label, direccion: '' };
  guardarUbicacion(loc);
  mostrarResultados(loc);
}

function mostrarPasoUbicacion() {
  ocultar('estado-inicial');
  ocultar('barra-ubicacion');
  ocultar('mapa-comercios');
  ocultar('btn-ver-todos');
  ocultar('lista');
  ocultar('sin-comercios');
  ocultar('aviso-radio');
  mostrar('paso-ubicacion');
}

function usarGeolocalizacion() {
  if (!navigator.geolocation) {
    document.getElementById('ub-error').textContent = 'Tu navegador no soporta geolocalización.';
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => resolverPorGps(pos),
    () => {
      document.getElementById('ub-error').textContent =
        'No pudimos acceder a tu ubicación. Completá la dirección y ciudad.';
    },
    { timeout: 8000 }
  );
}

// --- Autocompletar ciudad ---

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('ub-ciudad');
  input.addEventListener('input', () => {
    ciudadSeleccionada = null;
    const q = input.value.trim();
    clearTimeout(debounceCiudad);
    if (q.length < 2) {
      renderSugerencias([]);
      return;
    }
    debounceCiudad = setTimeout(() => buscarCiudades(q), 300);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.autocomplete-wrap')) renderSugerencias([]);
  });
});

async function buscarCiudades(q) {
  try {
    const res = await fetch(`/api/geo/localidades?q=${encodeURIComponent(q)}`);
    const ciudades = await res.json();
    renderSugerencias(ciudades);
  } catch (e) {
    renderSugerencias([]);
  }
}

function renderSugerencias(ciudades) {
  const cont = document.getElementById('ub-sugerencias');
  if (!ciudades.length) {
    cont.classList.add('oculto');
    cont.innerHTML = '';
    return;
  }
  cont.innerHTML = ciudades.map((c, i) => `
    <div class="autocomplete-item" data-i="${i}">${escapeHtml(c.nombre)}<span>${escapeHtml(c.provincia)}</span></div>
  `).join('');
  cont.classList.remove('oculto');
  cont.querySelectorAll('.autocomplete-item').forEach((el) => {
    el.addEventListener('click', () => {
      const c = ciudades[parseInt(el.dataset.i, 10)];
      ciudadSeleccionada = c;
      document.getElementById('ub-ciudad').value = `${c.nombre}, ${c.provincia}`;
      renderSugerencias([]);
    });
  });
}

function confirmarUbicacionManual() {
  const errEl = document.getElementById('ub-error');
  errEl.textContent = '';

  const calle = document.getElementById('ub-calle').value.trim();
  const altura = document.getElementById('ub-altura').value.trim();
  const depto = document.getElementById('ub-depto').value.trim();

  if (!ciudadSeleccionada) {
    errEl.textContent = 'Elegí tu ciudad de la lista de sugerencias.';
    return;
  }

  const partesCalle = [];
  if (calle) partesCalle.push(altura ? `${calle} ${altura}` : calle);
  if (depto) partesCalle.push(depto);
  const direccionTexto = partesCalle.join(', ');

  const label = direccionTexto
    ? `${direccionTexto}, ${ciudadSeleccionada.nombre}, ${ciudadSeleccionada.provincia}`
    : `${ciudadSeleccionada.nombre}, ${ciudadSeleccionada.provincia}`;

  const loc = {
    lat: ciudadSeleccionada.lat,
    lng: ciudadSeleccionada.lng,
    label,
    direccion: direccionTexto,
    calle,
    altura,
    depto,
  };
  guardarUbicacion(loc);
  mostrarResultados(loc);
}

function cambiarUbicacion() {
  localStorage.removeItem(STORAGE_KEY);
  if (mapa) {
    mapa.remove();
    mapa = null;
  }
  document.getElementById('ub-calle').value = '';
  document.getElementById('ub-altura').value = '';
  document.getElementById('ub-depto').value = '';
  document.getElementById('ub-ciudad').value = '';
  ciudadSeleccionada = null;
  mostrarPasoUbicacion();
}

// --- Resultados: mapa + lista ---

async function buscarComerciosConRadio(lat, lng) {
  for (const radio of RADIOS_FALLBACK) {
    const qs = radio ? `&radio_km=${radio}` : '';
    let comercios = [];
    try {
      const res = await fetch(`/api/comercios?lat=${lat}&lng=${lng}${qs}`);
      comercios = await res.json();
    } catch (e) {
      comercios = [];
    }
    if (comercios.length > 0 || radio === null) {
      return { comercios, radio };
    }
  }
  return { comercios: [], radio: null };
}

function zoomParaRadio(radioKm) {
  if (radioKm === RADIO_ZONA_KM) return 16;
  if (radioKm === 2) return 14;
  return 12;
}

async function mostrarResultados(loc) {
  ocultar('estado-inicial');
  ocultar('paso-ubicacion');

  document.getElementById('ubicacion-label').textContent = loc.label;
  mostrar('barra-ubicacion');

  const { comercios, radio } = await buscarComerciosConRadio(loc.lat, loc.lng);
  comerciosZona = comercios;

  mostrar('mapa-comercios');
  const zoom = zoomParaRadio(radio);
  if (!mapa) {
    mapa = L.map('mapa-comercios').setView([loc.lat, loc.lng], zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(mapa);
  } else {
    mapa.setView([loc.lat, loc.lng], zoom);
  }
  L.circleMarker([loc.lat, loc.lng], {
    radius: 8,
    color: '#1a7f5a',
    fillColor: '#1a7f5a',
    fillOpacity: 0.9,
  }).addTo(mapa).bindPopup('Estás acá');

  const avisoEl = document.getElementById('aviso-radio');
  if (comercios.length > 0 && radio !== RADIO_ZONA_KM) {
    avisoEl.textContent =
      radio === null
        ? 'No encontramos comercios a 8 cuadras: te mostramos todos los disponibles.'
        : `No encontramos comercios a 8 cuadras: ampliamos la búsqueda a ${radio} km.`;
    mostrar('aviso-radio');
  } else {
    ocultar('aviso-radio');
  }

  if (comercios.length === 0) {
    mostrar('sin-comercios');
    ocultar('btn-ver-todos');
    ocultar('lista');
    return;
  }
  ocultar('sin-comercios');

  comercios.forEach((c) => {
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return;
    const marker = L.marker([c.lat, c.lng]).addTo(mapa);
    const popupHtml = `
      <strong>${escapeHtml(c.nombre)}</strong><br/>
      <span style="color:#666;font-size:12px;">${escapeHtml(c.categoria || '')}</span><br/>
      <a href="/negocio.html?id=${c.id}" style="color:#1a7f5a;font-weight:600;">Ver comercio →</a>
    `;
    marker.bindPopup(popupHtml);
  });

  const btn = document.getElementById('btn-ver-todos');
  btn.textContent = `Ver los ${comercios.length} comercios de tu zona`;
  mostrar('btn-ver-todos');
  renderLista(comercios);
}

function renderLista(comercios) {
  document.getElementById('lista').innerHTML = comercios.map((c) => `
    <div class="tarjeta comercio-card" onclick="location.href='/negocio.html?id=${c.id}'">
      <div class="info">
        <h3>${escapeHtml(c.nombre)}</h3>
        <p>${escapeHtml(c.categoria || '')} · ${escapeHtml(c.direccion || '')}</p>
        <div class="badges">
          ${c.acepta_envio ? '<span class="badge">Envío</span>' : ''}
          ${c.acepta_retiro ? '<span class="badge naranja">Retiro en local</span>' : ''}
        </div>
      </div>
      ${c.distancia_km != null ? `<div class="distancia">${c.distancia_km} km</div>` : ''}
    </div>
  `).join('');
}

function toggleListaComercios() {
  const lista = document.getElementById('lista');
  const btn = document.getElementById('btn-ver-todos');
  const oculta = lista.classList.contains('oculto');
  if (oculta) {
    lista.classList.remove('oculto');
    btn.textContent = 'Ocultar lista';
    lista.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else {
    lista.classList.add('oculto');
    btn.textContent = `Ver los ${comerciosZona.length} comercios de tu zona`;
  }
}

init();
