export interface ClassStats {
  maxHp: number;
  speed: number;
  weaponCooldownMs: number;
  projectileDamage: number;
  projectileSpeed: number;
}

export interface EvolutionOption {
  id: string;
  label: string;
  statModifiers: Partial<ClassStats>;
  /** Si esta opción define una rama (nivel 3), el nombre que se muestra en el HUD. */
  name?: string;
  /** Sub-opciones que se habilitan en el siguiente umbral, solo si se eligió esta. */
  next?: EvolutionOption[];
}

export interface LevelUpChoice {
  level: number;
  options: EvolutionOption[];
}

// Sistema de progresión estilo diep.io: no hay selección de clase antes de
// jugar. Todos arrancan como Recluta con stats neutras, y en los umbrales de
// nivel el jugador elige cómo especializarse — cada elección abre las
// siguientes, formando un árbol en vez de una clase fija de entrada.
export const BASE_NAME = "Recluta";

export const BASE_STATS: ClassStats = {
  maxHp: 95,
  speed: 175,
  weaponCooldownMs: 350,
  projectileDamage: 10,
  projectileSpeed: 700,
};

export const EVOLUTION_LEVELS: LevelUpChoice[] = [
  {
    level: 3,
    options: [
      {
        id: "branch_assault",
        name: "Asalto",
        label: "Asalto — más cadencia y daño de fuego",
        statModifiers: { maxHp: 5, weaponCooldownMs: -60, projectileDamage: 3 },
        next: [
          { id: "assault_rof", label: "Más cadencia de fuego", statModifiers: { weaponCooldownMs: -80 } },
          { id: "assault_shotgun", label: "Escopeta de área", statModifiers: { projectileDamage: 6, weaponCooldownMs: 100 } },
        ],
      },
      {
        id: "branch_engineer",
        name: "Ingeniero",
        label: "Ingeniero — más resistencia",
        statModifiers: { maxHp: 20, speed: -15, weaponCooldownMs: 20 },
        next: [
          { id: "engineer_armor", label: "Blindaje personal", statModifiers: { maxHp: 30 } },
          { id: "engineer_dmg", label: "Munición perforante", statModifiers: { projectileDamage: 6 } },
        ],
      },
      {
        id: "branch_sniper",
        name: "Francotirador",
        label: "Francotirador — alto daño a distancia",
        statModifiers: { projectileDamage: 30, projectileSpeed: 350, weaponCooldownMs: 400, speed: -20 },
        next: [
          { id: "sniper_dmg", label: "Munición de alto calibre", statModifiers: { projectileDamage: 20 } },
          { id: "sniper_rof", label: "Cerrojo rápido", statModifiers: { weaponCooldownMs: -150 } },
        ],
      },
      {
        id: "branch_medic",
        name: "Médico",
        label: "Médico — soporte y velocidad",
        statModifiers: { maxHp: 5, speed: 10, weaponCooldownMs: 80, projectileDamage: -3 },
        next: [
          { id: "medic_hp", label: "Resistencia de campo", statModifiers: { maxHp: 25 } },
          { id: "medic_speed", label: "Piernas rápidas", statModifiers: { speed: 25 } },
        ],
      },
      {
        id: "branch_pilot",
        name: "Piloto",
        label: "Piloto — velocidad y maniobra",
        statModifiers: { speed: 20, weaponCooldownMs: -10 },
        next: [
          { id: "pilot_dmg", label: "Pistola de servicio mejorada", statModifiers: { projectileDamage: 6 } },
          { id: "pilot_rof", label: "Mano firme", statModifiers: { weaponCooldownMs: -60 } },
        ],
      },
    ],
  },
];

export const XP_PER_KILL = 60;

export function xpRequiredForLevel(level: number): number {
  return 80 + (level - 1) * 60;
}

export const STAT_GROWTH_MAX_LEVEL = 10; // a partir de este nivel la progresión natural deja de crecer

export function getEffectiveStats(chosenEvolutionIds: string[], level = 1): ClassStats {
  const stats: ClassStats = { ...BASE_STATS };

  // progresión gradual por nivel, estilo diep.io: empezás chico y lento, y creces de a poco
  const growthSteps = Math.min(level, STAT_GROWTH_MAX_LEVEL) - 1;
  stats.maxHp *= 1 + growthSteps * 0.05;
  stats.speed *= 1 + growthSteps * 0.02;
  stats.projectileDamage *= 1 + growthSteps * 0.04;

  applyChosenModifiers(EVOLUTION_LEVELS[0].options, chosenEvolutionIds, stats);

  stats.weaponCooldownMs = Math.max(80, stats.weaponCooldownMs);
  stats.maxHp = Math.round(stats.maxHp);
  stats.speed = Math.round(stats.speed);
  stats.projectileDamage = Math.round(stats.projectileDamage);
  return stats;
}

function applyChosenModifiers(options: EvolutionOption[], chosenEvolutionIds: string[], stats: ClassStats) {
  for (const option of options) {
    if (!chosenEvolutionIds.includes(option.id)) continue;
    for (const key of Object.keys(option.statModifiers) as (keyof ClassStats)[]) {
      stats[key] += option.statModifiers[key] ?? 0;
    }
    if (option.next) applyChosenModifiers(option.next, chosenEvolutionIds, stats);
  }
}

/** Encuentra las opciones disponibles para el próximo umbral de nivel, según lo ya elegido. */
export function findEvolutionChoice(chosenEvolutionIds: string[], level: number): LevelUpChoice | undefined {
  if (level === 3) return EVOLUTION_LEVELS[0];

  const rootChosen = EVOLUTION_LEVELS[0].options.find((o) => chosenEvolutionIds.includes(o.id));
  if (!rootChosen?.next) return undefined;
  return { level, options: rootChosen.next };
}

/** Nombre de clase a mostrar en el HUD, según la rama elegida (o "Recluta" si todavía no eligió). */
export function getDisplayName(chosenEvolutionIds: string[]): string {
  const rootChosen = EVOLUTION_LEVELS[0].options.find((o) => chosenEvolutionIds.includes(o.id));
  return rootChosen?.name ?? BASE_NAME;
}

/** A qué nivel pertenece una evolución elegida (para saber si sigue siendo válida tras bajar de nivel al morir). */
export function findEvolutionOptionLevel(evolutionId: string): number | undefined {
  for (const option of EVOLUTION_LEVELS[0].options) {
    if (option.id === evolutionId) return 3;
    if (option.next?.some((n) => n.id === evolutionId)) return 5;
  }
  return undefined;
}
