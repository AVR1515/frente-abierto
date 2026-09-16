import { SPATIAL_GRID_CELL_SIZE } from "shared";

interface Entry<T> {
  id: string;
  x: number;
  y: number;
  data: T;
}

/**
 * Grilla espacial uniforme para acelerar las búsquedas de colisión: en vez de comparar
 * cada proyectil contra todas las entidades del mapa, sólo se comparan contra las que
 * caen en las celdas cercanas. Se reconstruye una vez por tick (barata, O(n)).
 */
export class SpatialGrid<T> {
  private cells = new Map<string, Entry<T>[]>();
  private cellSize: number;

  constructor(cellSize = SPATIAL_GRID_CELL_SIZE) {
    this.cellSize = cellSize;
  }

  clear() {
    this.cells.clear();
  }

  insert(id: string, x: number, y: number, data: T) {
    const key = this.cellKey(x, y);
    const bucket = this.cells.get(key);
    if (bucket) bucket.push({ id, x, y, data });
    else this.cells.set(key, [{ id, x, y, data }]);
  }

  /** Devuelve las entradas en las celdas que tocan el círculo (x, y, radius). */
  queryRadius(x: number, y: number, radius: number): Entry<T>[] {
    const minCellX = Math.floor((x - radius) / this.cellSize);
    const maxCellX = Math.floor((x + radius) / this.cellSize);
    const minCellY = Math.floor((y - radius) / this.cellSize);
    const maxCellY = Math.floor((y + radius) / this.cellSize);

    const results: Entry<T>[] = [];
    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cy = minCellY; cy <= maxCellY; cy++) {
        const bucket = this.cells.get(`${cx}:${cy}`);
        if (bucket) results.push(...bucket);
      }
    }
    return results;
  }

  private cellKey(x: number, y: number): string {
    return `${Math.floor(x / this.cellSize)}:${Math.floor(y / this.cellSize)}`;
  }
}
