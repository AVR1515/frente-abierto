import { Room, Client } from "colyseus";
import { RoomState } from "../state/RoomState";
import { Player } from "../state/Player";
import { Projectile } from "../state/Projectile";
import { ControlPoint } from "../state/ControlPoint";
import { Vehicle } from "../state/Vehicle";
import { SpatialGrid } from "../util/SpatialGrid";
import {
  TICK_RATE_HZ,
  MAP_WIDTH,
  MAP_HEIGHT,
  PLAYER_RADIUS,
  PROJECTILE_RADIUS,
  PROJECTILE_LIFETIME_MS,
  DEATH_LEVEL_PENALTY,
  InputMessage,
  CLASSES,
  XP_PER_KILL,
  xpRequiredForLevel,
  getEffectiveStats,
  findEvolutionChoice,
  CONTROL_POINTS,
  TEAM_SPAWNS,
  STARTING_TICKETS,
  CAPTURE_SPEED_PER_SEC,
  CAPTURE_OWNER_THRESHOLD,
  BASE_TICKET_DRAIN_PER_SEC,
  TICKET_DRAIN_PER_ENEMY_POINT,
  MATCH_DURATION_SEC,
  TeamId,
  VEHICLES,
  VEHICLE_SPAWNS,
  VEHICLE_ENTER_RADIUS,
  VEHICLE_RESPAWN_MS,
  VEHICLE_XP_PER_KILL,
  vehicleXpRequiredForLevel,
  getVehicleEffectiveStats,
  findVehicleEvolutionChoice,
  VehicleType,
  MAX_PLAYERS_PER_ROOM,
  MAX_PROJECTILES_PER_ROOM,
  BOT_TARGET_PER_TEAM,
  BOT_DETECTION_RADIUS,
  BOT_PREFERRED_DISTANCE,
  BOT_AIM_JITTER_RAD,
  BOT_DECISION_INTERVAL_MS,
  BOT_STRAFE_CHANGE_MS,
} from "shared";

const BOT_CLASS_IDS = Object.keys(CLASSES);

interface PlayerInput {
  moveX: number;
  moveY: number;
  angle: number;
}

export class GameRoom extends Room<RoomState> {
  maxClients = MAX_PLAYERS_PER_ROOM;
  protected friendlyFire = false;

  private lastInputs = new Map<string, PlayerInput>();
  private lastShotAt = new Map<string, number>();
  private lastVehicleShotAt = new Map<string, number>();
  private projectileSeq = 0;
  private playerGrid = new SpatialGrid<Player>();
  private vehicleGrid = new SpatialGrid<Vehicle>();

  private bots = new Set<string>();
  private botSeq = 0;
  private botStrafeSign = new Map<string, number>();
  private botNextStrafeAt = new Map<string, number>();
  private botNextDecisionAt = new Map<string, number>();
  private botDecision = new Map<string, { moveX: number; moveY: number; angle: number }>();

  onCreate(_options?: any) {
    this.setState(new RoomState());

    CONTROL_POINTS.forEach((def) => {
      const cp = new ControlPoint();
      cp.id = def.id;
      cp.x = def.x;
      cp.y = def.y;
      cp.radius = def.radius;
      this.state.controlPoints.set(def.id, cp);
    });
    this.state.redTickets = STARTING_TICKETS;
    this.state.blueTickets = STARTING_TICKETS;
    this.state.matchTimeRemaining = MATCH_DURATION_SEC;

    VEHICLE_SPAWNS.forEach((def) => {
      const vehicle = new Vehicle();
      vehicle.id = def.id;
      vehicle.vehicleType = def.type;
      vehicle.team = def.team;
      vehicle.x = def.x;
      vehicle.y = def.y;
      vehicle.spawnX = def.x;
      vehicle.spawnY = def.y;
      const stats = getVehicleEffectiveStats(def.type, []);
      vehicle.maxHp = stats.maxHp;
      vehicle.hp = stats.maxHp;
      this.state.vehicles.set(def.id, vehicle);
    });

    this.onMessage("input", (client, message: InputMessage) => {
      this.lastInputs.set(client.sessionId, {
        moveX: clamp(message.moveX, -1, 1),
        moveY: clamp(message.moveY, -1, 1),
        angle: message.angle,
      });

      const player = this.state.players.get(client.sessionId);
      if (player) player.lastProcessedSeq = message.seq;
    });

    this.onMessage("shoot", (client, message: { angle: number }) => {
      this.handleShootFor(client.sessionId, message.angle);
    });

    this.onMessage("evolve", (client, message: { optionId: string }) => {
      this.handleEvolve(client, message.optionId);
    });

    this.onMessage("enterVehicle", (client, message: { vehicleId: string }) => {
      this.handleEnterVehicle(client, message.vehicleId);
    });

    this.onMessage("exitVehicle", (client) => {
      this.handleExitVehicle(client);
    });

    this.onMessage("vehicleShoot", (client, message: { angle: number }) => {
      this.handleVehicleShoot(client, message.angle);
    });

    this.onMessage("vehicleEvolve", (client, message: { optionId: string }) => {
      this.handleVehicleEvolve(client, message.optionId);
    });

    // panel de rendimiento del cliente: ida y vuelta para medir ping
    this.onMessage("ping", (client, message: { t: number }) => {
      client.send("pong", message);
    });

    this.setSimulationInterval((deltaTime) => this.update(deltaTime), 1000 / TICK_RATE_HZ);

    this.rebalanceBots();

    console.log("GameRoom creada");
  }

  onJoin(client: Client, options: { classId?: string }) {
    const player = new Player();
    player.classId = options?.classId && CLASSES[options.classId] ? options.classId : "assault";
    player.team = this.pickBalancedTeam();

    const stats = getEffectiveStats(player.classId, []);
    player.maxHp = stats.maxHp;
    player.hp = stats.maxHp;
    this.placeAtTeamSpawn(player);

    this.state.players.set(client.sessionId, player);
    console.log(`${client.sessionId} se unió al equipo ${player.team}`);

    this.rebalanceBots();
  }

  onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (player?.vehicleId) {
      const vehicle = this.state.vehicles.get(player.vehicleId);
      if (vehicle && vehicle.driverSessionId === client.sessionId) vehicle.driverSessionId = "";
    }

    this.state.players.delete(client.sessionId);
    this.lastInputs.delete(client.sessionId);
    this.lastShotAt.delete(client.sessionId);

    this.rebalanceBots();
  }

  private pickBalancedTeam(): TeamId {
    let red = 0;
    let blue = 0;
    this.state.players.forEach((p) => {
      if (p.team === "red") red++;
      else blue++;
    });
    return red <= blue ? "red" : "blue";
  }

  private placeAtTeamSpawn(player: Player) {
    const spawn = TEAM_SPAWNS[player.team as TeamId];
    player.x = clamp(spawn.x + (Math.random() - 0.5) * 120, PLAYER_RADIUS, MAP_WIDTH - PLAYER_RADIUS);
    player.y = clamp(spawn.y + (Math.random() - 0.5) * 120, PLAYER_RADIUS, MAP_HEIGHT - PLAYER_RADIUS);
  }

  // ---------- Bots ----------

  /** Mantiene un mínimo de jugadores (reales + bots) por equipo, para que el servidor nunca se sienta vacío. */
  private rebalanceBots() {
    (["red", "blue"] as TeamId[]).forEach((team) => {
      let real = 0;
      const botIds: string[] = [];
      this.state.players.forEach((player, sessionId) => {
        if (player.team !== team) return;
        if (player.isBot) botIds.push(sessionId);
        else real++;
      });

      const desiredBots = Math.max(0, BOT_TARGET_PER_TEAM - real);
      if (botIds.length < desiredBots) {
        for (let i = botIds.length; i < desiredBots; i++) this.spawnBot(team);
      } else if (botIds.length > desiredBots) {
        const excess = botIds.length - desiredBots;
        for (let i = 0; i < excess; i++) this.removeBot(botIds[i]);
      }
    });
  }

  private spawnBot(team: TeamId) {
    const botId = `bot_${this.botSeq++}`;
    const player = new Player();
    player.isBot = true;
    player.team = team;
    player.classId = BOT_CLASS_IDS[Math.floor(Math.random() * BOT_CLASS_IDS.length)];

    const stats = getEffectiveStats(player.classId, []);
    player.maxHp = stats.maxHp;
    player.hp = stats.maxHp;
    this.placeAtTeamSpawn(player);

    this.state.players.set(botId, player);
    this.bots.add(botId);
  }

  private removeBot(botId: string) {
    this.state.vehicles.forEach((vehicle) => {
      if (vehicle.driverSessionId === botId) vehicle.driverSessionId = "";
    });

    this.state.players.delete(botId);
    this.bots.delete(botId);
    this.lastInputs.delete(botId);
    this.lastShotAt.delete(botId);
    this.botStrafeSign.delete(botId);
    this.botNextStrafeAt.delete(botId);
    this.botNextDecisionAt.delete(botId);
    this.botDecision.delete(botId);
  }

  private updateBots(dt: number, now: number) {
    this.bots.forEach((botId) => {
      const bot = this.state.players.get(botId);
      if (!bot || bot.hp <= 0) return;

      if ((this.botNextDecisionAt.get(botId) ?? 0) <= now) {
        this.botNextDecisionAt.set(botId, now + BOT_DECISION_INTERVAL_MS);
        this.decideBotAction(botId, bot, now);
      }

      const decision = this.botDecision.get(botId);
      if (decision) this.lastInputs.set(botId, decision);
    });
  }

  private decideBotAction(botId: string, bot: Player, now: number) {
    let nearestEnemy: { x: number; y: number } | null = null;
    let nearestDist = BOT_DETECTION_RADIUS;

    this.state.players.forEach((other, otherId) => {
      if (otherId === botId || other.team === bot.team || other.hp <= 0 || other.vehicleId) return;
      const dist = Math.hypot(other.x - bot.x, other.y - bot.y);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestEnemy = other;
      }
    });

    if (nearestEnemy) {
      const target = nearestEnemy as { x: number; y: number };
      const angleToTarget = Math.atan2(target.y - bot.y, target.x - bot.x);
      const aimAngle = angleToTarget + (Math.random() - 0.5) * 2 * BOT_AIM_JITTER_RAD;

      if ((this.botNextStrafeAt.get(botId) ?? 0) <= now) {
        this.botNextStrafeAt.set(botId, now + BOT_STRAFE_CHANGE_MS);
        this.botStrafeSign.set(botId, Math.random() < 0.5 ? -1 : 1);
      }
      const strafeSign = this.botStrafeSign.get(botId) ?? 1;
      const perpAngle = angleToTarget + (Math.PI / 2) * strafeSign;

      let moveAngle: number;
      if (nearestDist > BOT_PREFERRED_DISTANCE + 60) {
        moveAngle = angleToTarget; // se acerca
      } else if (nearestDist < BOT_PREFERRED_DISTANCE - 60) {
        moveAngle = angleToTarget + Math.PI; // se aleja
      } else {
        moveAngle = perpAngle; // rodea al objetivo
      }

      this.botDecision.set(botId, { moveX: Math.cos(moveAngle), moveY: Math.sin(moveAngle), angle: aimAngle });
      this.handleShootFor(botId, aimAngle);
      return;
    }

    // sin enemigos cerca: avanzar hacia el punto de control disputable más cercano
    let targetPoint = { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };
    let nearestPointDist = Infinity;
    this.state.controlPoints.forEach((cp) => {
      if (cp.ownerTeam === bot.team) return;
      const dist = Math.hypot(cp.x - bot.x, cp.y - bot.y);
      if (dist < nearestPointDist) {
        nearestPointDist = dist;
        targetPoint = { x: cp.x, y: cp.y };
      }
    });

    const angleToPoint = Math.atan2(targetPoint.y - bot.y, targetPoint.x - bot.x);
    const closeToTarget = nearestPointDist < 60;
    this.botDecision.set(botId, {
      moveX: closeToTarget ? 0 : Math.cos(angleToPoint),
      moveY: closeToTarget ? 0 : Math.sin(angleToPoint),
      angle: angleToPoint,
    });
  }

  // ---------- Combate a pie ----------

  private handleShootFor(sessionId: string, angle: number) {
    const player = this.state.players.get(sessionId);
    if (!player || player.hp <= 0 || player.vehicleId || this.state.matchEnded) return;

    if (this.state.projectiles.size >= MAX_PROJECTILES_PER_ROOM) return;

    const stats = getEffectiveStats(player.classId, Array.from(player.chosenEvolutions) as string[], player.level);
    const now = Date.now();
    const last = this.lastShotAt.get(sessionId) ?? 0;
    if (now - last < stats.weaponCooldownMs) return;
    this.lastShotAt.set(sessionId, now);

    const projectile = new Projectile();
    projectile.ownerId = sessionId;
    projectile.ownerType = "player";
    projectile.x = player.x + Math.cos(angle) * (PLAYER_RADIUS + PROJECTILE_RADIUS);
    projectile.y = player.y + Math.sin(angle) * (PLAYER_RADIUS + PROJECTILE_RADIUS);
    projectile.vx = Math.cos(angle) * stats.projectileSpeed;
    projectile.vy = Math.sin(angle) * stats.projectileSpeed;
    projectile.spawnedAt = now;
    projectile.damage = stats.projectileDamage;

    this.state.projectiles.set(`p${this.projectileSeq++}`, projectile);
  }

  private handleEvolve(client: Client, optionId: string) {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.pendingEvolutionLevel === 0) return;

    const choice = findEvolutionChoice(player.classId, player.pendingEvolutionLevel);
    if (!choice) {
      player.pendingEvolutionLevel = 0;
      return;
    }

    const option = choice.options.find((o) => o.id === optionId);
    if (!option) return; // opción inválida para esta clase/nivel, se ignora

    player.chosenEvolutions.push(option.id);
    player.pendingEvolutionLevel = 0;
    this.applyStatsToPlayer(player);
    this.tryLevelUp(player);
  }

  private applyStatsToPlayer(player: Player) {
    const stats = getEffectiveStats(player.classId, Array.from(player.chosenEvolutions) as string[], player.level);
    if (stats.maxHp > player.maxHp) {
      player.hp += stats.maxHp - player.maxHp;
    }
    player.maxHp = stats.maxHp;
    player.hp = Math.min(player.hp, player.maxHp);
  }

  private tryLevelUp(player: Player) {
    if (player.pendingEvolutionLevel !== 0) return;

    while (player.xp >= xpRequiredForLevel(player.level)) {
      player.xp -= xpRequiredForLevel(player.level);
      player.level += 1;

      const choice = findEvolutionChoice(player.classId, player.level);
      if (choice) {
        player.pendingEvolutionLevel = player.level;
        return;
      }
    }
  }

  private awardXp(player: Player, amount: number) {
    player.xp += amount;
    this.tryLevelUp(player);
  }

  // ---------- Vehículos ----------

  private handleEnterVehicle(client: Client, vehicleId: string) {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.hp <= 0 || player.vehicleId) return;

    const vehicle = this.state.vehicles.get(vehicleId);
    if (!vehicle || vehicle.destroyed || vehicle.driverSessionId || vehicle.team !== player.team) return;

    const distance = Math.hypot(player.x - vehicle.x, player.y - vehicle.y);
    if (distance > VEHICLE_ENTER_RADIUS) return;

    vehicle.driverSessionId = client.sessionId;
    player.vehicleId = vehicleId;
  }

  private handleExitVehicle(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.vehicleId) return;

    const vehicle = this.state.vehicles.get(player.vehicleId);
    if (vehicle && vehicle.driverSessionId === client.sessionId) {
      vehicle.driverSessionId = "";
      player.x = clamp(vehicle.x, PLAYER_RADIUS, MAP_WIDTH - PLAYER_RADIUS);
      player.y = clamp(vehicle.y + PLAYER_RADIUS * 2, PLAYER_RADIUS, MAP_HEIGHT - PLAYER_RADIUS);
    }
    player.vehicleId = "";
  }

  private handleVehicleShoot(client: Client, angle: number) {
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.vehicleId || this.state.matchEnded) return;

    const vehicle = this.state.vehicles.get(player.vehicleId);
    if (!vehicle || vehicle.destroyed || vehicle.driverSessionId !== client.sessionId) return;

    if (this.state.projectiles.size >= MAX_PROJECTILES_PER_ROOM) return;

    const stats = getVehicleEffectiveStats(vehicle.vehicleType as VehicleType, Array.from(vehicle.chosenEvolutions) as string[]);
    const now = Date.now();
    const last = this.lastVehicleShotAt.get(vehicle.id) ?? 0;
    if (now - last < stats.weaponCooldownMs) return;
    this.lastVehicleShotAt.set(vehicle.id, now);

    const def = VEHICLES[vehicle.vehicleType as VehicleType];
    const originRadius = def.radius + PROJECTILE_RADIUS;

    const projectile = new Projectile();
    projectile.ownerId = vehicle.id;
    projectile.ownerType = "vehicle";
    projectile.x = vehicle.x + Math.cos(angle) * originRadius;
    projectile.y = vehicle.y + Math.sin(angle) * originRadius;
    projectile.vx = Math.cos(angle) * stats.projectileSpeed;
    projectile.vy = Math.sin(angle) * stats.projectileSpeed;
    projectile.spawnedAt = now;
    projectile.damage = stats.damage;

    this.state.projectiles.set(`p${this.projectileSeq++}`, projectile);
  }

  private handleVehicleEvolve(client: Client, optionId: string) {
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.vehicleId) return;

    const vehicle = this.state.vehicles.get(player.vehicleId);
    if (!vehicle || vehicle.driverSessionId !== client.sessionId || vehicle.pendingEvolutionLevel === 0) return;

    const choice = findVehicleEvolutionChoice(vehicle.vehicleType as VehicleType, vehicle.pendingEvolutionLevel);
    if (!choice) {
      vehicle.pendingEvolutionLevel = 0;
      return;
    }

    const option = choice.options.find((o) => o.id === optionId);
    if (!option) return;

    vehicle.chosenEvolutions.push(option.id);
    vehicle.pendingEvolutionLevel = 0;
    this.applyStatsToVehicle(vehicle);
    this.tryVehicleLevelUp(vehicle);
  }

  private applyStatsToVehicle(vehicle: Vehicle) {
    const stats = getVehicleEffectiveStats(vehicle.vehicleType as VehicleType, Array.from(vehicle.chosenEvolutions) as string[]);
    if (stats.maxHp > vehicle.maxHp) {
      vehicle.hp += stats.maxHp - vehicle.maxHp;
    }
    vehicle.maxHp = stats.maxHp;
    vehicle.hp = Math.min(vehicle.hp, vehicle.maxHp);
  }

  private tryVehicleLevelUp(vehicle: Vehicle) {
    if (vehicle.pendingEvolutionLevel !== 0) return;

    while (vehicle.xp >= vehicleXpRequiredForLevel(vehicle.level)) {
      vehicle.xp -= vehicleXpRequiredForLevel(vehicle.level);
      vehicle.level += 1;

      const choice = findVehicleEvolutionChoice(vehicle.vehicleType as VehicleType, vehicle.level);
      if (choice) {
        vehicle.pendingEvolutionLevel = vehicle.level;
        return;
      }
    }
  }

  private awardVehicleXp(vehicle: Vehicle, amount: number) {
    vehicle.xp += amount;
    this.tryVehicleLevelUp(vehicle);
  }

  private destroyVehicle(vehicle: Vehicle) {
    if (vehicle.driverSessionId) {
      const driver = this.state.players.get(vehicle.driverSessionId);
      if (driver) {
        driver.vehicleId = "";
        driver.x = clamp(vehicle.x, PLAYER_RADIUS, MAP_WIDTH - PLAYER_RADIUS);
        driver.y = clamp(vehicle.y, PLAYER_RADIUS, MAP_HEIGHT - PLAYER_RADIUS);
      }
    }
    vehicle.driverSessionId = "";
    vehicle.destroyed = true;
    vehicle.respawnAt = Date.now() + VEHICLE_RESPAWN_MS;
    this.broadcast("vehicleDestroyed", { vehicleId: vehicle.id });
  }

  private respawnVehicle(vehicle: Vehicle) {
    vehicle.destroyed = false;
    vehicle.x = vehicle.spawnX;
    vehicle.y = vehicle.spawnY;
    vehicle.chassisRotation = 0;
    vehicle.turretRotation = 0;
    const stats = getVehicleEffectiveStats(vehicle.vehicleType as VehicleType, Array.from(vehicle.chosenEvolutions) as string[]);
    vehicle.maxHp = stats.maxHp;
    vehicle.hp = stats.maxHp;
  }

  // ---------- Loop principal ----------

  private update(deltaTime: number) {
    if (this.state.matchEnded) return;

    const dt = deltaTime / 1000;

    this.updateBots(dt, Date.now());

    this.state.players.forEach((player, sessionId) => {
      if (player.hp <= 0 || player.vehicleId) return;
      const input = this.lastInputs.get(sessionId);
      if (!input) return;

      const stats = getEffectiveStats(player.classId, Array.from(player.chosenEvolutions) as string[], player.level);
      const magnitude = Math.min(1, Math.hypot(input.moveX, input.moveY));
      const moveAngle = Math.atan2(input.moveY, input.moveX);
      const dx = Math.cos(moveAngle) * magnitude * stats.speed * dt;
      const dy = Math.sin(moveAngle) * magnitude * stats.speed * dt;

      player.x = clamp(player.x + dx, PLAYER_RADIUS, MAP_WIDTH - PLAYER_RADIUS);
      player.y = clamp(player.y + dy, PLAYER_RADIUS, MAP_HEIGHT - PLAYER_RADIUS);
      player.rotation = input.angle;
    });

    this.updateVehicles(dt);
    this.updateProjectiles(dt);
    this.updateConquest(dt);
  }

  private updateVehicles(dt: number) {
    this.state.vehicles.forEach((vehicle) => {
      if (vehicle.destroyed) {
        if (Date.now() >= vehicle.respawnAt) this.respawnVehicle(vehicle);
        return;
      }
      if (!vehicle.driverSessionId) return;

      const input = this.lastInputs.get(vehicle.driverSessionId);
      if (!input) return;

      const def = VEHICLES[vehicle.vehicleType as VehicleType];
      const stats = getVehicleEffectiveStats(vehicle.vehicleType as VehicleType, Array.from(vehicle.chosenEvolutions) as string[]);

      const magnitude = Math.min(1, Math.hypot(input.moveX, input.moveY));
      if (magnitude > 0.05 && stats.chassisSpeed > 0) {
        const desiredAngle = Math.atan2(input.moveY, input.moveX);
        vehicle.chassisRotation = turnToward(vehicle.chassisRotation, desiredAngle, stats.turnRatePerSec * dt);
        vehicle.x = clamp(
          vehicle.x + Math.cos(vehicle.chassisRotation) * stats.chassisSpeed * magnitude * dt,
          PLAYER_RADIUS,
          MAP_WIDTH - PLAYER_RADIUS
        );
        vehicle.y = clamp(
          vehicle.y + Math.sin(vehicle.chassisRotation) * stats.chassisSpeed * magnitude * dt,
          PLAYER_RADIUS,
          MAP_HEIGHT - PLAYER_RADIUS
        );
      }

      if (def.hasTurret) {
        vehicle.turretRotation = turnToward(vehicle.turretRotation, input.angle, stats.turretTurnRatePerSec * dt);
      } else {
        vehicle.turretRotation = vehicle.chassisRotation;
      }

      const driver = this.state.players.get(vehicle.driverSessionId);
      if (driver) {
        driver.x = vehicle.x;
        driver.y = vehicle.y;
        driver.rotation = vehicle.chassisRotation;
      }
    });
  }

  /** Reconstruye las grillas espaciales una vez por tick para acelerar las colisiones (Fase 8). */
  private rebuildCollisionGrids() {
    this.playerGrid.clear();
    this.state.players.forEach((player, sessionId) => {
      if (player.hp <= 0 || player.vehicleId) return;
      this.playerGrid.insert(sessionId, player.x, player.y, player);
    });

    this.vehicleGrid.clear();
    this.state.vehicles.forEach((vehicle, id) => {
      if (vehicle.destroyed) return;
      this.vehicleGrid.insert(id, vehicle.x, vehicle.y, vehicle);
    });
  }

  private updateProjectiles(dt: number) {
    this.rebuildCollisionGrids();

    const now = Date.now();
    const toRemove: string[] = [];
    // radio de búsqueda holgado para no perder vehículos grandes cuyo centro cae en la celda vecina
    const queryRadius = PROJECTILE_RADIUS + PLAYER_RADIUS + 60;

    this.state.projectiles.forEach((projectile, id) => {
      if (now - projectile.spawnedAt > PROJECTILE_LIFETIME_MS) {
        toRemove.push(id);
        return;
      }

      projectile.x += projectile.vx * dt;
      projectile.y += projectile.vy * dt;

      if (projectile.x < 0 || projectile.x > MAP_WIDTH || projectile.y < 0 || projectile.y > MAP_HEIGHT) {
        toRemove.push(id);
        return;
      }

      const shooterTeam =
        projectile.ownerType === "vehicle"
          ? this.state.vehicles.get(projectile.ownerId)?.team
          : this.state.players.get(projectile.ownerId)?.team;

      let alreadyHit = false;

      const nearbyPlayers = this.playerGrid.queryRadius(projectile.x, projectile.y, queryRadius);
      for (const entry of nearbyPlayers) {
        if (alreadyHit) break;
        const player = entry.data;
        if (entry.id === projectile.ownerId) continue;
        if (!this.friendlyFire && shooterTeam && player.team === shooterTeam) continue;

        const distance = Math.hypot(player.x - projectile.x, player.y - projectile.y);
        if (distance <= PLAYER_RADIUS + PROJECTILE_RADIUS) {
          alreadyHit = true;
          player.hp = Math.max(0, player.hp - projectile.damage);
          toRemove.push(id);
          this.broadcast("hit", { sessionId: entry.id, x: projectile.x, y: projectile.y });

          if (player.hp === 0) {
            if (projectile.ownerType === "vehicle") {
              const shooterVehicle = this.state.vehicles.get(projectile.ownerId);
              if (shooterVehicle) this.awardVehicleXp(shooterVehicle, VEHICLE_XP_PER_KILL);
            } else {
              const shooter = this.state.players.get(projectile.ownerId);
              if (shooter) this.awardXp(shooter, XP_PER_KILL);
            }
            this.respawnPlayer(player);
          }
        }
      }

      const nearbyVehicles = this.vehicleGrid.queryRadius(projectile.x, projectile.y, queryRadius);
      for (const entry of nearbyVehicles) {
        if (alreadyHit) break;
        const vehicle = entry.data;
        if (projectile.ownerType === "vehicle" && projectile.ownerId === entry.id) continue;
        if (!this.friendlyFire && shooterTeam && vehicle.team === shooterTeam) continue;

        const def = VEHICLES[vehicle.vehicleType as VehicleType];
        const distance = Math.hypot(vehicle.x - projectile.x, vehicle.y - projectile.y);
        if (distance <= def.radius + PROJECTILE_RADIUS) {
          alreadyHit = true;
          vehicle.hp = Math.max(0, vehicle.hp - projectile.damage);
          toRemove.push(id);
          this.broadcast("hit", { vehicleId: entry.id, x: projectile.x, y: projectile.y });

          if (vehicle.hp === 0) {
            if (projectile.ownerType === "vehicle") {
              const shooterVehicle = this.state.vehicles.get(projectile.ownerId);
              if (shooterVehicle) this.awardVehicleXp(shooterVehicle, VEHICLE_XP_PER_KILL);
            } else {
              const shooter = this.state.players.get(projectile.ownerId);
              if (shooter) this.awardXp(shooter, XP_PER_KILL);
            }
            this.destroyVehicle(vehicle);
          }
        }
      }
    });

    toRemove.forEach((id) => this.state.projectiles.delete(id));
  }

  /** Daño en área usado por el bombardeo del Comandante (Fase 7). No aplica a la propia facción. */
  protected applyAreaDamage(x: number, y: number, radius: number, damage: number, friendlyTeam: string) {
    this.state.players.forEach((player, sessionId) => {
      if (player.hp <= 0 || player.vehicleId || player.team === friendlyTeam) return;
      if (Math.hypot(player.x - x, player.y - y) > radius) return;

      player.hp = Math.max(0, player.hp - damage);
      this.broadcast("hit", { sessionId, x, y });
      if (player.hp === 0) this.respawnPlayer(player);
    });

    this.state.vehicles.forEach((vehicle) => {
      if (vehicle.destroyed || vehicle.team === friendlyTeam) return;
      const def = VEHICLES[vehicle.vehicleType as VehicleType];
      if (Math.hypot(vehicle.x - x, vehicle.y - y) > radius + def.radius) return;

      vehicle.hp = Math.max(0, vehicle.hp - damage);
      this.broadcast("hit", { vehicleId: vehicle.id, x, y });
      if (vehicle.hp === 0) this.destroyVehicle(vehicle);
    });
  }

  private updateConquest(dt: number) {
    this.state.controlPoints.forEach((cp) => {
      let redCount = 0;
      let blueCount = 0;

      this.state.players.forEach((player) => {
        if (player.hp <= 0 || player.vehicleId) return;
        const distance = Math.hypot(player.x - cp.x, player.y - cp.y);
        if (distance <= cp.radius) {
          if (player.team === "red") redCount++;
          else blueCount++;
        }
      });

      // los vehículos también cuentan como presencia para capturar (a pedido del usuario)
      this.state.vehicles.forEach((vehicle) => {
        if (vehicle.destroyed || !vehicle.driverSessionId) return;
        const distance = Math.hypot(vehicle.x - cp.x, vehicle.y - cp.y);
        if (distance <= cp.radius) {
          if (vehicle.team === "red") redCount++;
          else blueCount++;
        }
      });

      if (redCount > blueCount) {
        cp.captureValue = clamp(cp.captureValue - CAPTURE_SPEED_PER_SEC * dt, -1, 1);
      } else if (blueCount > redCount) {
        cp.captureValue = clamp(cp.captureValue + CAPTURE_SPEED_PER_SEC * dt, -1, 1);
      }

      if (cp.captureValue <= -CAPTURE_OWNER_THRESHOLD) cp.ownerTeam = "red";
      else if (cp.captureValue >= CAPTURE_OWNER_THRESHOLD) cp.ownerTeam = "blue";
      else if (Math.abs(cp.captureValue) < 0.05) cp.ownerTeam = "neutral";
      // si está en un valor intermedio, conserva el último dueño (punto disputado)
    });

    let redControlled = 0;
    let blueControlled = 0;
    this.state.controlPoints.forEach((cp) => {
      if (cp.ownerTeam === "red") redControlled++;
      else if (cp.ownerTeam === "blue") blueControlled++;
    });

    const redDrain = BASE_TICKET_DRAIN_PER_SEC + blueControlled * TICKET_DRAIN_PER_ENEMY_POINT;
    const blueDrain = BASE_TICKET_DRAIN_PER_SEC + redControlled * TICKET_DRAIN_PER_ENEMY_POINT;
    this.state.redTickets = Math.max(0, this.state.redTickets - redDrain * dt);
    this.state.blueTickets = Math.max(0, this.state.blueTickets - blueDrain * dt);

    this.state.matchTimeRemaining = Math.max(0, this.state.matchTimeRemaining - dt);

    if (this.state.redTickets <= 0 || this.state.blueTickets <= 0 || this.state.matchTimeRemaining <= 0) {
      this.endMatch();
    }
  }

  private endMatch() {
    this.state.matchEnded = true;

    if (this.state.redTickets <= 0 && this.state.blueTickets <= 0) {
      this.state.winningTeam = "draw";
    } else if (this.state.redTickets <= 0) {
      this.state.winningTeam = "blue";
    } else if (this.state.blueTickets <= 0) {
      this.state.winningTeam = "red";
    } else if (this.state.redTickets > this.state.blueTickets) {
      this.state.winningTeam = "red";
    } else if (this.state.blueTickets > this.state.redTickets) {
      this.state.winningTeam = "blue";
    } else {
      this.state.winningTeam = "draw";
    }

    this.broadcast("matchEnded", { winningTeam: this.state.winningTeam });
    console.log(`Partida terminada. Ganador: ${this.state.winningTeam}`);
  }

  private respawnPlayer(player: Player) {
    player.level = Math.max(1, player.level - DEATH_LEVEL_PENALTY);
    player.xp = 0;
    player.pendingEvolutionLevel = 0;

    // conservar solo las evoluciones cuyo umbral de nivel sigue alcanzado
    const kept = (Array.from(player.chosenEvolutions) as string[]).filter((evoId) => {
      const def = CLASSES[player.classId];
      const choice = def.evolutions.find((e) => e.options.some((o) => o.id === evoId));
      return choice ? choice.level <= player.level : false;
    });
    player.chosenEvolutions.clear();
    kept.forEach((id) => player.chosenEvolutions.push(id));

    this.applyStatsToPlayer(player);
    player.hp = player.maxHp;
    this.placeAtTeamSpawn(player);
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function turnToward(current: number, target: number, maxDelta: number): number {
  if (maxDelta <= 0) return current;
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) <= maxDelta) return current + diff;
  return current + Math.sign(diff) * maxDelta;
}
