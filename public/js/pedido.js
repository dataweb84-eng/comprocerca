function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const ETIQUETAS = {
  pendiente: 'Pendiente de confirmación',
  preparando: 'Preparando tu pedido',
  listo: '¡Listo! ',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

const params = new URLSearchParams(location.search);
const publicId = params.get('id');

function render(pedido) {
  const etiquetaEntrega = pedido.tipo_entrega === 'envio' ? 'te lo enviamos' : 'para retirar en el local';
  document.getElementById('contenido').innerHTML = `
    <div class="tarjeta">
      <span class="estado-pill ${pedido.estado}" id="estado-pill">${ETIQUETAS[pedido.estado] || pedido.estado}</span>
      <p style="color:var(--texto-suave);font-size:13px;margin-top:10px;">
        Pedido en <strong>${escapeHtml(pedido.business.nombre)}</strong> — ${etiquetaEntrega}
      </p>
      ${pedido.tipo_entrega === 'envio' ? `<p style="font-size:13px;">📍 ${escapeHtml(pedido.direccion_entrega)}</p>` : ''}
      <p style="font-size:12px;color:var(--texto-suave);">Pagás en el comercio (efectivo o tarjeta).</p>
    </div>
    <div class="tarjeta">
      <h4 style="margin-top:0;">Detalle</h4>
      ${pedido.items.map((it) => `
        <div class="linea-item">
          <span>${it.cantidad} ${escapeHtml(it.unidad)} — ${escapeHtml(it.product_nombre)}
            ${it.nota ? `<small>${escapeHtml(it.nota)}</small>` : ''}
          </span>
        </div>
      `).join('')}
    </div>
  `;
}

async function cargar() {
  const res = await fetch(`/api/pedidos/${publicId}`);
  if (!res.ok) {
    document.getElementById('contenido').innerHTML = '<div class="estado-vacio">No encontramos ese pedido.</div>';
    return;
  }
  const pedido = await res.json();
  render(pedido);

  const socket = io();
  socket.on('connect', () => socket.emit('join_pedido', publicId));
  socket.on('estado_actualizado', ({ estado }) => {
    pedido.estado = estado;
    render(pedido);
  });
}

cargar();
