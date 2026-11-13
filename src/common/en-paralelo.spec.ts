import { enParalelo } from './en-paralelo';

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('enParalelo', () => {
  it('respeta el límite de tareas simultáneas', async () => {
    let enCurso = 0;
    let maximo = 0;
    await enParalelo([1, 2, 3, 4, 5, 6, 7], 3, async () => {
      enCurso++;
      maximo = Math.max(maximo, enCurso);
      await esperar(5);
      enCurso--;
    });
    expect(maximo).toBe(3);
  });

  it('ante un error espera a las tareas en curso y no inicia nuevas', async () => {
    const terminadas: number[] = [];
    const iniciadas: number[] = [];

    await expect(
      enParalelo([1, 2, 3, 4], 2, async (n) => {
        iniciadas.push(n);
        if (n === 1) throw new Error('falla');
        await esperar(20);
        terminadas.push(n);
      }),
    ).rejects.toThrow('falla');

    expect(iniciadas).toEqual([1, 2]); // tras el fallo no arrancó la 3 ni la 4
    expect(terminadas).toEqual([2]); // la 2 ya había terminado al rechazar
  });
});
