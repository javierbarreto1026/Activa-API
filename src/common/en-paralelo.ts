/**
 * Ejecuta `tarea` sobre cada elemento con, como máximo, `limite` tareas simultáneas.
 *
 * Si una tarea falla deja de iniciar tareas nuevas, ESPERA a que terminen las que
 * ya estaban en curso y luego relanza el primer error. Así, quien llama puede
 * limpiar (p. ej. borrar copias en R2) sabiendo que ya no queda nada ejecutándose.
 */
export async function enParalelo<T>(
  elementos: readonly T[],
  limite: number,
  tarea: (elemento: T, indice: number) => Promise<void>,
): Promise<void> {
  let siguiente = 0;
  let fallo = false;
  let primerError: unknown;

  const trabajador = async () => {
    while (!fallo && siguiente < elementos.length) {
      const indice = siguiente++;
      try {
        await tarea(elementos[indice], indice);
      } catch (err) {
        if (!fallo) {
          fallo = true;
          primerError = err;
        }
      }
    }
  };

  const hilos = Math.max(1, Math.min(limite, elementos.length));
  await Promise.all(Array.from({ length: hilos }, trabajador));
  if (fallo) throw primerError;
}
