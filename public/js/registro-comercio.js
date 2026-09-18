let mapa = null;
let marker = null;
let ciudadSeleccionada = null;
let debounceCiudad = null;
let selectedLat = -36.6167; // centro por defecto (La Pampa) hasta que elijan ciudad
let selectedLng = -64.2833;

function initMapa() {
  mapa = L.map('mapa-registro').setView([selectedLat, selectedLng], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(mapa);
  marker = L.marker([selectedLat, selectedLng], { draggable: true }).addTo(mapa);
  marker.on('dragend', () => {
    const pos = marker.getLatLng();
    selectedLat = pos.lat;
    selectedLng = pos.lng;
  });
  mapa.on('click', (e) => moverMarcador(e.latlng.lat, e.latlng.lng));
}

function moverMarcador(lat, lng, zoom) {
  selectedLat = lat;
  selectedLng = lng;
  marker.setLatLng([lat, lng]);
  mapa.setView([lat, lng], zoom || mapa.getZoom());
}

// --- Autocompletar ciudad (mismo patrón que el home) ---

document.addEventListener('DOMContentLoaded', () => {
  initMapa();

  const input = document.getElementById('r-ciudad');
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

  document.getElementById('r-altura').addEventListener('blur', intentarGeocodificar);
  document.getElementById('r-calle').addEventListener('blur', intentarGeocodificar);
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
  const cont = document.getElementById('r-sugerencias');
  if (!ciudades.length) {
    cont.classList.add('oculto');
    cont.innerHTML = '';
    return;
  }
  cont.innerHTML = ciudades
    .map(
      (c, i) => `<div class="autocomplete-item" data-i="${i}">${c.nombre}<span>${c.provincia}</span></div>`
    )
    .join('');
  cont.classList.remove('oculto');
  cont.querySelectorAll('.autocomplete-item').forEach((el) => {
    el.addEventListener('click', () => {
      const c = ciudades[parseInt(el.dataset.i, 10)];
      ciudadSeleccionada = c;
      document.getElementById('r-ciudad').value = `${c.nombre}, ${c.provincia}`;
      renderSugerencias([]);
      moverMarcador(c.lat, c.lng, 14);
      intentarGeocodificar();
    });
  });
}

async function intentarGeocodificar() {
  const calle = document.getElementById('r-calle').value.trim();
  const altura = document.getElementById('r-altura').value.trim();
  if (!calle || !ciudadSeleccionada) return;
  try {
    const qs = new URLSearchParams({
      calle,
      altura,
      provincia: ciudadSeleccionada.provincia,
      localidad: ciudadSeleccionada.nombre,
    });
    const r = await fetch(`/api/geo/direccion?${qs.toString()}`);
    const data = await r.json();
    if (Number.isFinite(data.lat) && Number.isFinite(data.lng)) {
      moverMarcador(data.lat, data.lng, 16);
    }
  } catch (e) { /* si falla, el pin queda donde estaba (centro de la ciudad o ajuste manual) */ }
}

// --- Alta del comercio ---

async function registrarComercio() {
  const errEl = document.getElementById('r-error');
  errEl.textContent = '';

  const nombre = document.getElementById('r-nombre').value.trim();
  const categoria = document.getElementById('r-categoria').value.trim();
  const telefono = document.getElementById('r-telefono').value.trim();
  const calle = document.getElementById('r-calle').value.trim();
  const altura = document.getElementById('r-altura').value.trim();
  const acepta_envio = document.getElementById('r-envio').checked;
  const acepta_retiro = document.getElementById('r-retiro').checked;
  const username = document.getElementById('r-username').value.trim();
  const password = document.getElementById('r-password').value;

  if (!nombre || !username || !password) {
    errEl.textContent = 'Completá al menos nombre, usuario y contraseña.';
    return;
  }
  if (password.length < 6) {
    errEl.textContent = 'La contraseña tiene que tener al menos 6 caracteres.';
    return;
  }
  if (!acepta_envio && !acepta_retiro) {
    errEl.textContent = 'Elegí al menos una forma de entrega (envío o retiro).';
    return;
  }

  const direccion = [
    calle ? (altura ? `${calle} ${altura}` : calle) : null,
    ciudadSeleccionada ? `${ciudadSeleccionada.nombre}, ${ciudadSeleccionada.provincia}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  const res = await fetch('/api/comercio/registro', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nombre,
      categoria,
      telefono,
      direccion,
      lat: selectedLat,
      lng: selectedLng,
      username,
      password,
      acepta_envio,
      acepta_retiro,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    errEl.textContent = data.error || 'No pudimos crear tu comercio.';
    return;
  }
  location.href = '/comercio-admin.html?bienvenida=1';
}
