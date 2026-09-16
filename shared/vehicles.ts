import type { TeamId } from "./conquest";

export type VehicleType = "jeep" | "tank" | "artillery";

export interface VehicleStats {
  maxHp: number;
  chassisSpeed: number; // px/s, 0 = estacionario
  turnRatePerSec: number; // radianes/s que puede girar el chasis
  turretTurnRatePerSec: number; // radianes/s de la torreta (si aplica)
  weaponCooldownMs: number;
  damage: number;
  projectileSpeed: number;
}

export interface VehicleEvolutionOption {
  id: string;
  label: string;
  statModifiers: Partial<VehicleStats>;
}

export interface VehicleLevelUpChoice {
  level: number;
  options: VehicleEvolutionOption[];
}

export interface VehicleDefinition {
  id: VehicleType;
  name: string;
  hasTurret: boolean;
  radius: number;
  baseStats: VehicleStats;
  evolutions: VehicleLevelUpChoice[];
}

export const VEHICLES: Record<VehicleType, VehicleDefinition> = {
  jeep: {
    id: "jeep",
    name: "Jeep",
    hasTurret: false,
    radius: 32,
    baseStats: {
      maxHp: 130,
      chassisSpeed: 340,
      turnRatePerSec: 3.4,
      turretTurnRatePerSec: 0,
      weaponCooldownMs: 250,
      damage: 8,
      projectileSpeed: 750,
    },
    evolutions: [
      {
        level: 2,
        options: [
          { id: "jeep_armor", label: "Blindaje ligero", statModifiers: { maxHp: 60 } },
          { id: "jeep_engine", label: "Motor turbo", statModifiers: { chassisSpeed: 90 } },
        ],
      },
    ],
  },
  tank: {
    id: "tank",
    name: "Tanque",
    hasTurret: true,
    radius: 45,
    baseStats: {
      maxHp: 320,
      chassisSpeed: 140,
      turnRatePerSec: 1.6,
      turretTurnRatePerSec: 2.6,
      weaponCooldownMs: 900,
      damage: 45,
      projectileSpeed: 600,
    },
    evolutions: [
      {
        level: 2,
        options: [
          { id: "tank_armor", label: "Blindaje reforzado", statModifiers: { maxHp: 160 } },
          { id: "tank_second_cannon", label: "Segundo cañón", statModifiers: { weaponCooldownMs: -400 } },
        ],
      },
    ],
  },
  artillery: {
    id: "artillery",
    name: "Artillería",
    hasTurret: true,
    radius: 40,
    baseStats: {
      maxHp: 160,
      chassisSpeed: 0,
      turnRatePerSec: 0,
      turretTurnRatePerSec: 0.7,
      weaponCooldownMs: 3200,
      damage: 100,
      projectileSpeed: 950,
    },
    evolutions: [
      {
        level: 2,
        options: [
          { id: "arty_range", label: "Pólvora mejorada", statModifiers: { projectileSpeed: 350 } },
          { id: "arty_dmg", label: "Ojivas pesadas", statModifiers: { damage: 50 } },
        ],
      },
    ],
  },
};

export interface VehicleSpawnDef {
  id: string;
  type: VehicleType;
  team: TeamId;
  x: number;
  y: number;
}

export const VEHICLE_SPAWNS: VehicleSpawnDef[] = [
  { id: "v_red_jeep", type: "jeep", team: "red", x: 280, y: 850 },
  { id: "v_red_tank", type: "tank", team: "red", x: 280, y: 1150 },
  { id: "v_red_arty", type: "artillery", team: "red", x: 100, y: 1000 },
  { id: "v_blue_jeep", type: "jeep", team: "blue", x: 1720, y: 850 },
  { id: "v_blue_tank", type: "tank", team: "blue", x: 1720, y: 1150 },
  { id: "v_blue_arty", type: "artillery", team: "blue", x: 1900, y: 1000 },
];

export const VEHICLE_ENTER_RADIUS = 70;
export const VEHICLE_RESPAWN_MS = 25000;
export const VEHICLE_XP_PER_KILL = 60;

export function vehicleXpRequiredForLevel(level: number): number {
  return 150 + (level - 1) * 100;
}

export function getVehicleEffectiveStats(type: VehicleType, chosenEvolutionIds: string[]): VehicleStats {
  const def = VEHICLES[type];
  const stats: VehicleStats = { ...def.baseStats };

  for (const choice of def.evolutions) {
    for (const option of choice.options) {
      if (!chosenEvolutionIds.includes(option.id)) continue;
      for (const key of Object.keys(option.statModifiers) as (keyof VehicleStats)[]) {
        stats[key] += (option.statModifiers as any)[key] ?? 0;
      }
    }
  }

  stats.weaponCooldownMs = Math.max(150, stats.weaponCooldownMs);
  return stats;
}

export function findVehicleEvolutionChoice(type: VehicleType, level: number): VehicleLevelUpChoice | undefined {
  return VEHICLES[type]?.evolutions.find((e) => e.level === level);
}
