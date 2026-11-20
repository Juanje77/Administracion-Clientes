// Claves de ARCA y de Rentas de cada cliente, en `claves/{clienteId}`. Son datos de trabajo del estudio: se guardan tal cual
// (la base solo la lee el servidor) y se muestran en la sección Claves a quien tenga ese permiso.
const { db } = require('../db');

const claves = () => db.collection('claves');
const CAMPOS = ['arca', 'rentas'];

// clienteId -> { arca, rentas }
async function todas() {
  const snap = await claves().get();
  return new Map(snap.docs.map((d) => [d.id, { arca: d.data().arca ?? null, rentas: d.data().rentas ?? null }]));
}

// cambios: { arca?, rentas? } — undefined = no tocar, '' = borrar
async function guardar(clienteId, cambios, usuarioId) {
  const datos = { actualizadoEn: new Date(), actualizadoPor: usuarioId };
  for (const c of CAMPOS) {
    if (cambios[c] === undefined) continue;
    datos[c] = cambios[c].trim() === '' ? null : cambios[c].trim();
  }
  await claves().doc(clienteId).set(datos, { merge: true });
}

const borrarDeCliente = (clienteId) => claves().doc(clienteId).delete();

module.exports = { CAMPOS, todas, guardar, borrarDeCliente };
