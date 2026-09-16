export const COMMANDER_STRIKE_COST = 3;
export const COMMANDER_STRIKE_DAMAGE = 60;
export const COMMANDER_STRIKE_RADIUS = 150;
export const COMMANDER_STRIKE_DELAY_MS = 1200; // telegraph antes del impacto
export const COMMANDER_MAX_POINTS = 50;

export function normalizeDisplayName(name: string): string {
  return name.trim().toLowerCase();
}

export function generateRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin caracteres ambiguos
  let code = "";
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}
