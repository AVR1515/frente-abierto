export interface InputMessage {
  moveX: number; // -1..1
  moveY: number; // -1..1
  angle: number; // radians, dirección de apuntado
  seq: number; // número de secuencia del input, para reconciliación futura
}
