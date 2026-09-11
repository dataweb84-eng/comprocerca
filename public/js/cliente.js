function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function cargarComercios(lat, lng) {
  const listaEl = document.getElementById('lista');
  const params = lat != null ? `?lat=${lat}&lng=${lng}` : '';
  try {
    const res = await fetch(`/api/comercios${params}`);
    const comercios = await res.json();
    if (comercios.length === 0) {
      listaEl.innerHTML = '<div class="estado-vacio">Todavía no hay comercios cargados en tu zona.</div>';
      return;
    }
    listaEl.innerHTML = comercios.map((c) => `
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
  } catch (e) {
    listaEl.innerHTML = '<div class="estado-vacio">No pudimos cargar los comercios. Probá de nuevo más tarde.</div>';
  }
}

function mostrarAviso(texto) {
  const aviso = document.getElementById('aviso-ubicacion');
  aviso.textContent = texto;
  aviso.classList.remove('oculto');
}

if (!navigator.geolocation) {
  mostrarAviso('Tu navegador no soporta geolocalización. Te mostramos todos los comercios.');
  cargarComercios();
} else {
  navigator.geolocation.getCurrentPosition(
    (pos) => cargarComercios(pos.coords.latitude, pos.coords.longitude),
    () => {
      mostrarAviso('No pudimos acceder a tu ubicación. Te mostramos todos los comercios.');
      cargarComercios();
    },
    { timeout: 8000 }
  );
}
