function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const SIGUIENTE_ESTADO = { pendiente: 'preparando', preparando: 'listo', listo: 'entregado' };
const ETIQUETA_ACCION = { pendiente: 'Empezar a preparar', preparando: 'Marcar listo', listo: 'Marcar entregado' };
const ETIQUETA_ESTADO = {
  pendiente: 'Pendiente', preparando: 'Preparando', listo: 'Listo', entregado: 'Entregado', cancelado: 'Cancelado',
};

let perfil = null;

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch (e) { /* noop */ }
}

async function init() {
  const res = await fetch('/api/comercio/me');
  if (!res.ok) { location.href = '/comercio-login.html'; return; }
  const me = await res.json();
  document.getElementById('nombre-negocio').textContent = me.nombre;

  const socket = io();
  socket.on('connect', () => socket.emit('join_comercio'));
  socket.on('nuevo_pedido', () => {
    beep();
    cargarPedidos();
  });

  await cargarPerfil();
  await cargarPedidos();
  await cargarProductos();
}

function logout() {
  fetch('/api/comercio/logout', { method: 'POST' }).then(() => (location.href = '/comercio-login.html'));
}

function cambiarTab(tab) {
  for (const t of ['pedidos', 'productos', 'perfil']) {
    document.getElementById(`vista-${t}`).classList.toggle('oculto', t !== tab);
    document.getElementById(`tab-${t}`).classList.toggle('activo', t === tab);
  }
}

// --- Pedidos ---

async function cargarPedidos() {
  const res = await fetch('/api/comercio/pedidos');
  const pedidos = await res.json();
  const cont = document.getElementById('vista-pedidos');
  if (pedidos.length === 0) {
    cont.innerHTML = '<div class="estado-vacio">Todavía no llegaron pedidos.</div>';
    return;
  }
  cont.innerHTML = pedidos.map((p) => `
    <div class="tarjeta pedido-card ${p.estado}">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <strong>${escapeHtml(p.cliente_nombre)}</strong>
        <span class="estado-pill ${p.estado}">${ETIQUETA_ESTADO[p.estado]}</span>
      </div>
      <p style="font-size:13px;color:var(--texto-suave);margin:4px 0;">
        📞 ${escapeHtml(p.cliente_telefono)} · ${p.tipo_entrega === 'envio' ? 'Envío: ' + escapeHtml(p.direccion_entrega) : 'Retira en local'}
      </p>
      <div>
        ${p.items.map((it) => `<div class="linea-item"><span>${it.cantidad} ${escapeHtml(it.unidad)} — ${escapeHtml(it.product_nombre)} ${it.nota ? `<small>${escapeHtml(it.nota)}</small>` : ''}</span></div>`).join('')}
      </div>
      ${SIGUIENTE_ESTADO[p.estado] ? `
        <div class="fila" style="margin-top:10px;">
          <button onclick="cambiarEstado(${p.id}, '${SIGUIENTE_ESTADO[p.estado]}')">${ETIQUETA_ACCION[p.estado]}</button>
          <button class="secundario peligro-outline" style="color:var(--rojo);border:1px solid var(--rojo);background:#fff;" onclick="cambiarEstado(${p.id}, 'cancelado')">Cancelar</button>
        </div>
      ` : ''}
    </div>
  `).join('');
}

async function cambiarEstado(id, estado) {
  await fetch(`/api/comercio/pedidos/${id}/estado`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado }),
  });
  cargarPedidos();
}

// --- Productos ---

async function cargarProductos() {
  const res = await fetch('/api/comercio/productos');
  const productos = await res.json();
  const cont = document.getElementById('lista-productos');
  const usados = productos.length;
  const max = perfil ? perfil.max_productos : '?';
  cont.innerHTML = `
    <p style="font-size:13px;color:var(--texto-suave);">Usás ${usados} de ${max} productos de tu plan (${perfil ? escapeHtml(perfil.plan_nombre) : ''}).</p>
    ${productos.map((p) => `
      <div class="tarjeta">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <h4 style="margin:0;">${escapeHtml(p.nombre)} ${p.activo ? '' : '<span style="color:var(--texto-suave);">(pausado)</span>'}</h4>
            <p style="margin:2px 0;font-size:13px;color:var(--texto-suave);">${escapeHtml(p.descripcion || '')}</p>
            <p style="margin:0;font-size:13px;">$${p.precio} / ${escapeHtml(p.unidad)}</p>
          </div>
          <div class="fila" style="flex-direction:column;gap:6px;width:auto;">
            <button class="chico secundario" onclick="toggleProducto(${p.id}, ${p.activo ? 'false' : 'true'})">${p.activo ? 'Pausar' : 'Activar'}</button>
            <button class="chico peligro" onclick="borrarProducto(${p.id})">Borrar</button>
          </div>
        </div>
      </div>
    `).join('')}
  `;
}

async function crearProducto() {
  const nombre = document.getElementById('p-nombre').value.trim();
  const descripcion = document.getElementById('p-descripcion').value.trim();
  const precio = document.getElementById('p-precio').value;
  const unidad = document.getElementById('p-unidad').value.trim();
  const errEl = document.getElementById('p-error');
  errEl.textContent = '';

  if (!nombre || !unidad) { errEl.textContent = 'Completá al menos nombre y unidad.'; return; }

  const res = await fetch('/api/comercio/productos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre, descripcion, precio, unidad }),
  });
  const data = await res.json();
  if (!res.ok) { errEl.textContent = data.error; return; }

  document.getElementById('p-nombre').value = '';
  document.getElementById('p-descripcion').value = '';
  document.getElementById('p-precio').value = '';
  document.getElementById('p-unidad').value = '';
  cargarProductos();
}

async function toggleProducto(id, activo) {
  await fetch(`/api/comercio/productos/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activo }),
  });
  cargarProductos();
}

async function borrarProducto(id) {
  if (!confirm('¿Borrar este producto?')) return;
  await fetch(`/api/comercio/productos/${id}`, { method: 'DELETE' });
  cargarProductos();
}

// --- Perfil ---

async function cargarPerfil() {
  const res = await fetch('/api/comercio/perfil');
  perfil = await res.json();
  document.getElementById('perfil-direccion').value = perfil.direccion || '';
  document.getElementById('perfil-telefono').value = perfil.telefono || '';
  document.getElementById('perfil-envio').checked = !!perfil.acepta_envio;
  document.getElementById('perfil-retiro').checked = !!perfil.acepta_retiro;
}

async function guardarPerfil() {
  const direccion = document.getElementById('perfil-direccion').value.trim();
  const telefono = document.getElementById('perfil-telefono').value.trim();
  const acepta_envio = document.getElementById('perfil-envio').checked;
  const acepta_retiro = document.getElementById('perfil-retiro').checked;

  await fetch('/api/comercio/perfil', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direccion, telefono, acepta_envio, acepta_retiro }),
  });
  document.getElementById('perfil-msg').textContent = 'Guardado ✓';
  setTimeout(() => (document.getElementById('perfil-msg').textContent = ''), 2000);
}

init();
