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
}

export interface LevelUpChoice {
  level: number;
  options: EvolutionOption[];
}

export interface ClassDefinition {
  id: string;
  name: string;
  baseStats: ClassStats;
  evolutions: LevelUpChoice[];
}

export const CLASSES: Record<string, ClassDefinition> = {
  assault: {
    id: "assault",
    name: "Asalto",
    baseStats: { maxHp: 100, speed: 165, weaponCooldownMs: 300, projectileDamage: 12, projectileSpeed: 700 },
    evolutions: [
      {
        level: 3,
        options: [
          { id: "assault_rof", label: "Más cadencia de fuego", statModifiers: { weaponCooldownMs: -100 } },
          { id: "assault_shotgun", label: "Escopeta de área", statModifiers: { projectileDamage: 6, weaponCooldownMs: 150 } },
        ],
      },
      {
        level: 5,
        options: [
          { id: "assault_hp", label: "Chaleco reforzado", statModifiers: { maxHp: 40 } },
          { id: "assault_speed", label: "Botas ligeras", statModifiers: { speed: 40 } },
        ],
      },
    ],
  },
  engineer: {
    id: "engineer",
    name: "Ingeniero",
    baseStats: { maxHp: 110, speed: 150, weaponCooldownMs: 400, projectileDamage: 10, projectileSpeed: 650 },
    evolutions: [
      {
        level: 3,
        options: [
          { id: "engineer_armor", label: "Blindaje personal", statModifiers: { maxHp: 30 } },
          { id: "engineer_repair", label: "Kit de reparación mejorado", statModifiers: {} },
        ],
      },
      {
        level: 5,
        options: [
          { id: "engineer_dmg", label: "Munición perforante", statModifiers: { projectileDamage: 6 } },
          { id: "engineer_speed", label: "Mochila liviana", statModifiers: { speed: 30 } },
        ],
      },
    ],
  },
  sniper: {
    id: "sniper",
    name: "Francotirador",
    baseStats: { maxHp: 80, speed: 150, weaponCooldownMs: 900, projectileDamage: 45, projectileSpeed: 1100 },
    evolutions: [
      {
        level: 3,
        options: [
          { id: "sniper_dmg", label: "Munición de alto calibre", statModifiers: { projectileDamage: 20 } },
          { id: "sniper_rof", label: "Cerrojo rápido", statModifiers: { weaponCooldownMs: -200 } },
        ],
      },
      {
        level: 5,
        options: [
          { id: "sniper_hp", label: "Camuflaje reforzado", statModifiers: { maxHp: 25 } },
          { id: "sniper_speed", label: "Movilidad táctica", statModifiers: { speed: 30 } },
        ],
      },
    ],
  },
  medic: {
    id: "medic",
    name: "Médico",
    baseStats: { maxHp: 90, speed: 175, weaponCooldownMs: 500, projectileDamage: 8, projectileSpeed: 650 },
    evolutions: [
      {
        level: 3,
        options: [
          { id: "medic_heal", label: "Botiquín mejorado", statModifiers: {} },
          { id: "medic_speed", label: "Piernas rápidas", statModifiers: { speed: 40 } },
        ],
      },
      {
        level: 5,
        options: [
          { id: "medic_hp", label: "Resistencia de campo", statModifiers: { maxHp: 30 } },
          { id: "medic_dmg", label: "Pistola reforzada", statModifiers: { projectileDamage: 6 } },
        ],
      },
    ],
  },
  pilot: {
    id: "pilot",
    name: "Piloto",
    baseStats: { maxHp: 85, speed: 180, weaponCooldownMs: 350, projectileDamage: 10, projectileSpeed: 700 },
    evolutions: [
      {
        level: 3,
        options: [
          { id: "pilot_speed", label: "Reflejos de piloto", statModifiers: { speed: 40 } },
          { id: "pilot_hp", label: "Traje reforzado", statModifiers: { maxHp: 25 } },
        ],
      },
      {
        level: 5,
        options: [
          { id: "pilot_dmg", label: "Pistola de servicio mejorada", statModifiers: { projectileDamage: 8 } },
          { id: "pilot_rof", label: "Mano firme", statModifiers: { weaponCooldownMs: -80 } },
        ],
      },
    ],
  },
};

export const XP_PER_KILL = 60;

export function xpRequiredForLevel(level: number): number {
  return 80 + (level - 1) * 60;
}

export const STAT_GROWTH_MAX_LEVEL = 10; // a partir de este nivel la progresión natural deja de crecer

export function getEffectiveStats(classId: string, chosenEvolutionIds: string[], level = 1): ClassStats {
  const def = CLASSES[classId] ?? CLASSES.assault;
  const stats: ClassStats = { ...def.baseStats };

  // progresión gradual por nivel, estilo diep.io: empezás chico y lento, y creces de a poco
  // en vez de tener todo el poder desde el nivel 1. Las evoluciones elegidas se suman aparte.
  const growthSteps = Math.min(level, STAT_GROWTH_MAX_LEVEL) - 1;
  stats.maxHp *= 1 + growthSteps * 0.05;
  stats.speed *= 1 + growthSteps * 0.02;
  stats.projectileDamage *= 1 + growthSteps * 0.04;

  for (const choice of def.evolutions) {
    for (const option of choice.options) {
      if (!chosenEvolutionIds.includes(option.id)) continue;
      for (const key of Object.keys(option.statModifiers) as (keyof ClassStats)[]) {
        stats[key] += option.statModifiers[key] ?? 0;
      }
    }
  }

  stats.weaponCooldownMs = Math.max(80, stats.weaponCooldownMs);
  stats.maxHp = Math.round(stats.maxHp);
  stats.speed = Math.round(stats.speed);
  stats.projectileDamage = Math.round(stats.projectileDamage);
  return stats;
}

export function findEvolutionChoice(classId: string, level: number): LevelUpChoice | undefined {
  return CLASSES[classId]?.evolutions.find((e) => e.level === level);
}
