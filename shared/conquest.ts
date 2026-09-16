export type TeamId = "red" | "blue";

export interface ControlPointDef {
  id: string;
  x: number;
  y: number;
  radius: number;
}

export const CONTROL_POINTS: ControlPointDef[] = [
  { id: "A", x: 500, y: 500, radius: 130 },
  { id: "B", x: 500, y: 1500, radius: 130 },
  { id: "C", x: 1000, y: 1000, radius: 150 },
  { id: "D", x: 1500, y: 500, radius: 130 },
  { id: "E", x: 1500, y: 1500, radius: 130 },
];

export const TEAM_SPAWNS: Record<TeamId, { x: number; y: number }> = {
  red: { x: 150, y: 1000 },
  blue: { x: 1850, y: 1000 },
};

export const STARTING_TICKETS = 200;
export const CAPTURE_SPEED_PER_SEC = 0.18; // avance del medidor de captura (-1..1) por segundo con mayoría
export const CAPTURE_OWNER_THRESHOLD = 0.99; // qué tan cerca de -1/1 hace falta para que un equipo controle el punto

export const BASE_TICKET_DRAIN_PER_SEC = 0.4; // sangría constante para que la partida no se estanque
export const TICKET_DRAIN_PER_ENEMY_POINT = 0.9; // sangría extra por cada punto controlado por el rival

export const MATCH_DURATION_SEC = 10 * 60;
