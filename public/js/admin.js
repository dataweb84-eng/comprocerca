function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

let planesCache = [];
let editandoId = null;
let map, marker;
let selectedLat = -36.6167; // La Pampa, AR (centro por defecto)
let selectedLng = -64.2833;

function initMap() {
  map = L.map('mapa-picker').setView([selectedLat, selectedLng], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  map.on('click', (e) => setMarker(e.latlng.lat, e.latlng.lng));

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((pos) => {
      map.setView([pos.coords.latitude, pos.coords.longitude], 13);
    });
  }
}

function setMarker(lat, lng) {
  selectedLat = lat;
  selectedLng = lng;
  if (marker) marker.setLatLng([lat, lng]);
  else marker = L.marker([lat, lng]).addTo(map);
}

async function init() {
  const res = await fetch('/api/admin/me');
  if (!res.ok) { location.href = '/admin-login.html'; return; }
  initMap();
  await cargarPlanes();
  await cargarComercios();
}

function logout() {
  fetch('/api/admin/logout', { method: 'POST' }).then(() => (location.href = '/admin-login.html'));
}

function cambiarTab(tab) {
  for (const t of ['comercios', 'planes']) {
    document.getElementById(`vista-${t}`).classList.toggle('oculto', t !== tab);
    document.getElementById(`tab-${t}`).classList.toggle('activo', t === tab);
  }
  if (tab === 'comercios' && map) setTimeout(() => map.invalidateSize(), 50);
}

// --- Comercios ---

async function cargarComercios() {
  const res = await fetch('/api/admin/businesses');
  const comercios = await res.json();
  document.getElementById('lista-comercios').innerHTML = comercios.map((c) => `
    <div class="tarjeta ${c.plan_solicitado_id ? 'pedido-card' : ''}">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <h4 style="margin:0;">${escapeHtml(c.nombre)} ${c.activo ? '' : '<span style="color:var(--rojo);">(inactivo)</span>'}</h4>
          <p style="margin:2px 0;font-size:13px;color:var(--texto-suave);">${escapeHtml(c.categoria || '')} · ${escapeHtml(c.direccion || '')}</p>
          <p style="margin:0;font-size:12px;color:var(--texto-suave);">Usuario: ${escapeHtml(c.username)} · Plan: ${escapeHtml(c.plan_nombre || '—')}</p>
        </div>
      </div>
      ${c.plan_solicitado_id ? `
        <div class="aviso" style="margin-top:10px;margin-bottom:0;">
          🔔 Pidió pasar a <strong>${escapeHtml(c.plan_solicitado_nombre)}</strong> ($${Number(c.plan_solicitado_precio).toLocaleString('es-AR')}/mes).
          Verificá la transferencia a tu alias de Mercado Pago antes de aprobar.
          <div class="fila" style="margin-top:8px;">
            <button class="chico" onclick="aprobarPlan(${c.id})">✅ Aprobar</button>
            <button class="chico secundario" onclick="rechazarPlan(${c.id})">Rechazar</button>
          </div>
        </div>
      ` : ''}
      <div class="fila" style="margin-top:10px;">
        <button class="chico secundario" onclick='editarComercio(${JSON.stringify(c)})'>Editar</button>
        <button class="chico secundario" onclick="toggleActivo(${c.id}, ${c.activo ? 'false' : 'true'})">${c.activo ? 'Desactivar' : 'Activar'}</button>
        <button class="chico peligro" onclick="borrarComercio(${c.id})">Borrar</button>
      </div>
    </div>
  `).join('') || '<div class="estado-vacio">Todavía no hay comercios cargados.</div>';
}

async function aprobarPlan(id) {
  const res = await fetch(`/api/admin/businesses/${id}/aprobar-plan`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'No se pudo aprobar el plan'); return; }
  cargarComercios();
}

async function rechazarPlan(id) {
  if (!confirm('¿Rechazar el pedido de cambio de plan?')) return;
  await fetch(`/api/admin/businesses/${id}/rechazar-plan`, { method: 'POST' });
  cargarComercios();
}

function poblarSelectPlanes(selectedId) {
  const sel = document.getElementById('c-plan');
  sel.innerHTML = planesCache.map((p) => `<option value="${p.id}">${escapeHtml(p.nombre)} (${p.max_productos} prod.)</option>`).join('');
  if (selectedId) sel.value = selectedId;
}

function editarComercio(c) {
  editandoId = c.id;
  document.getElementById('form-comercio-titulo').textContent = `Editando: ${c.nombre}`;
  document.getElementById('c-nombre').value = c.nombre;
  document.getElementById('c-categoria').value = c.categoria || '';
  document.getElementById('c-direccion').value = c.direccion || '';
  document.getElementById('c-telefono').value = c.telefono || '';
  poblarSelectPlanes(c.plan_id);
  document.getElementById('c-username').value = c.username;
  document.getElementById('c-password').value = '';
  document.getElementById('label-password').textContent = 'Nueva contraseña (opcional)';
  document.getElementById('c-envio').checked = !!c.acepta_envio;
  document.getElementById('c-retiro').checked = !!c.acepta_retiro;
  document.getElementById('btn-guardar-comercio').textContent = 'Guardar cambios';
  document.getElementById('btn-cancelar-edicion').classList.remove('oculto');
  if (c.lat != null && c.lng != null) {
    setMarker(c.lat, c.lng);
    map.setView([c.lat, c.lng], 15);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelarEdicion() {
  editandoId = null;
  document.getElementById('form-comercio-titulo').textContent = 'Nuevo comercio';
  document.getElementById('c-nombre').value = '';
  document.getElementById('c-categoria').value = '';
  document.getElementById('c-direccion').value = '';
  document.getElementById('c-telefono').value = '';
  document.getElementById('c-username').value = '';
  document.getElementById('c-password').value = '';
  document.getElementById('label-password').textContent = 'Contraseña';
  document.getElementById('c-envio').checked = true;
  document.getElementById('c-retiro').checked = true;
  document.getElementById('btn-guardar-comercio').textContent = 'Crear comercio';
  document.getElementById('btn-cancelar-edicion').classList.add('oculto');
}

async function guardarComercio() {
  const errEl = document.getElementById('c-error');
  errEl.textContent = '';
  const body = {
    nombre: document.getElementById('c-nombre').value.trim(),
    categoria: document.getElementById('c-categoria').value.trim(),
    direccion: document.getElementById('c-direccion').value.trim(),
    telefono: document.getElementById('c-telefono').value.trim(),
    plan_id: document.getElementById('c-plan').value,
    username: document.getElementById('c-username').value.trim(),
    password: document.getElementById('c-password').value,
    acepta_envio: document.getElementById('c-envio').checked,
    acepta_retiro: document.getElementById('c-retiro').checked,
    lat: selectedLat,
    lng: selectedLng,
  };

  if (!body.nombre || !body.username || (!editandoId && !body.password)) {
    errEl.textContent = 'Completá nombre, usuario y contraseña.';
    return;
  }

  const url = editandoId ? `/api/admin/businesses/${editandoId}` : '/api/admin/businesses';
  const method = editandoId ? 'PUT' : 'POST';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) { errEl.textContent = data.error; return; }

  cancelarEdicion();
  cargarComercios();
}

async function toggleActivo(id, activo) {
  await fetch(`/api/admin/businesses/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activo }),
  });
  cargarComercios();
}

async function borrarComercio(id) {
  if (!confirm('¿Borrar este comercio y sus productos? Esta acción no se puede deshacer.')) return;
  await fetch(`/api/admin/businesses/${id}`, { method: 'DELETE' });
  cargarComercios();
}

// --- Planes ---

async function cargarPlanes() {
  const res = await fetch('/api/admin/plans');
  planesCache = await res.json();
  poblarSelectPlanes();
  document.getElementById('lista-planes').innerHTML = planesCache.map((p) => `
    <div class="tarjeta">
      <h4 style="margin:0;">${escapeHtml(p.nombre)}</h4>
      <p style="margin:4px 0;font-size:13px;color:var(--texto-suave);">${escapeHtml(p.descripcion || '')}</p>
      <p style="margin:0;font-size:13px;">Hasta ${p.max_productos} productos · $${p.precio}</p>
    </div>
  `).join('') || '<div class="estado-vacio">Todavía no hay planes.</div>';
}

async function crearPlan() {
  const errEl = document.getElementById('pl-error');
  errEl.textContent = '';
  const body = {
    nombre: document.getElementById('pl-nombre').value.trim(),
    max_productos: document.getElementById('pl-max').value,
    precio: document.getElementById('pl-precio').value,
    descripcion: document.getElementById('pl-descripcion').value.trim(),
  };
  if (!body.nombre || !body.max_productos) { errEl.textContent = 'Completá nombre y máximo de productos.'; return; }

  const res = await fetch('/api/admin/plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) { errEl.textContent = data.error; return; }

  document.getElementById('pl-nombre').value = '';
  document.getElementById('pl-max').value = '';
  document.getElementById('pl-precio').value = '';
  document.getElementById('pl-descripcion').value = '';
  cargarPlanes();
}

init();
