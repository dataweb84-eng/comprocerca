function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const params = new URLSearchParams(location.search);
const businessId = params.get('id');
let comercio = null;
let tipoEntrega = null;
const carrito = {}; // product_id -> { producto, cantidad, nota }

async function cargar() {
  const res = await fetch(`/api/comercios/${businessId}`);
  if (!res.ok) {
    document.getElementById('contenido').innerHTML = '<div class="estado-vacio">Comercio no encontrado.</div>';
    return;
  }
  comercio = await res.json();
  document.getElementById('nombre-comercio').textContent = comercio.nombre;

  const cont = document.getElementById('contenido');
  if (comercio.productos.length === 0) {
    cont.innerHTML = '<div class="estado-vacio">Este comercio todavía no cargó productos.</div>';
    return;
  }
  cont.innerHTML = `
    <div class="tarjeta">
      <p style="margin:0;color:var(--texto-suave);font-size:13px;">${escapeHtml(comercio.direccion || '')}</p>
      <div class="badges">
        ${comercio.acepta_envio ? '<span class="badge">Envío</span>' : ''}
        ${comercio.acepta_retiro ? '<span class="badge naranja">Retiro en local</span>' : ''}
      </div>
    </div>
    <div class="tarjeta">
      ${comercio.productos.map((p) => `
        <div class="producto-row">
          <div>
            <h4>${escapeHtml(p.nombre)}</h4>
            <p>${escapeHtml(p.descripcion || '')}</p>
            <div class="precio">$${p.precio} / ${escapeHtml(p.unidad)}</div>
          </div>
          <div style="text-align:right;">
            <input type="number" min="0" step="any" placeholder="Cant." style="width:70px;display:inline-block;margin-bottom:6px;"
              id="cant-${p.id}" />
            <br/>
            <button class="chico" onclick='agregarAlCarrito(${JSON.stringify(p)})'>Agregar</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function agregarAlCarrito(producto) {
  const cantInput = document.getElementById(`cant-${producto.id}`);
  const cantidad = parseFloat(cantInput.value);
  if (!Number.isFinite(cantidad) || cantidad <= 0) {
    cantInput.focus();
    return;
  }
  const nota = prompt('¿Alguna nota para este producto? (opcional, ej: "bien maduro")', '') || '';
  carrito[producto.id] = { producto, cantidad, nota };
  cantInput.value = '';
  actualizarBarraCarrito();
}

function actualizarBarraCarrito() {
  const items = Object.values(carrito);
  const barra = document.getElementById('barra-carrito');
  if (items.length === 0) {
    barra.classList.add('oculto');
    return;
  }
  barra.classList.remove('oculto');
  document.getElementById('resumen-carrito').textContent = `${items.length} producto(s) en el pedido`;
}

function abrirCheckout() {
  const items = Object.values(carrito);
  document.getElementById('resumen-items').innerHTML = items.map((it) => `
    <div class="linea-item">
      <span>${it.cantidad} ${escapeHtml(it.producto.unidad)} — ${escapeHtml(it.producto.nombre)}
        ${it.nota ? `<small>${escapeHtml(it.nota)}</small>` : ''}
      </span>
    </div>
  `).join('');

  tipoEntrega = null;
  document.getElementById('btn-retiro').classList.remove('oculto');
  document.getElementById('btn-envio').classList.remove('oculto');
  if (!comercio.acepta_retiro) document.getElementById('btn-retiro').classList.add('oculto');
  if (!comercio.acepta_envio) document.getElementById('btn-envio').classList.add('oculto');
  document.getElementById('campo-direccion').classList.add('oculto');
  document.getElementById('chk-error').textContent = '';

  document.getElementById('modal-checkout').classList.remove('oculto');
}

function cerrarCheckout() {
  document.getElementById('modal-checkout').classList.add('oculto');
}

function setTipoEntrega(tipo) {
  tipoEntrega = tipo;
  document.getElementById('btn-retiro').classList.toggle('secundario', tipo !== 'retiro');
  document.getElementById('btn-envio').classList.toggle('secundario', tipo !== 'envio');
  document.getElementById('campo-direccion').classList.toggle('oculto', tipo !== 'envio');
}

async function confirmarPedido() {
  const cliente_nombre = document.getElementById('chk-nombre').value.trim();
  const cliente_telefono = document.getElementById('chk-telefono').value.trim();
  const direccion_entrega = document.getElementById('chk-direccion').value.trim();
  const errEl = document.getElementById('chk-error');

  if (!cliente_nombre || !cliente_telefono) {
    errEl.textContent = 'Completá tu nombre y teléfono.';
    return;
  }
  if (!tipoEntrega) {
    errEl.textContent = 'Elegí si retirás en el local o pedís envío.';
    return;
  }
  if (tipoEntrega === 'envio' && !direccion_entrega) {
    errEl.textContent = 'Completá la dirección de envío.';
    return;
  }

  const items = Object.values(carrito).map((it) => ({
    product_id: it.producto.id,
    cantidad: it.cantidad,
    unidad: it.producto.unidad,
    nota: it.nota,
  }));

  const res = await fetch('/api/pedidos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      business_id: businessId,
      cliente_nombre,
      cliente_telefono,
      tipo_entrega: tipoEntrega,
      direccion_entrega,
      items,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    errEl.textContent = data.error || 'No pudimos enviar el pedido.';
    return;
  }
  location.href = `/pedido.html?id=${data.public_id}`;
}

cargar();
