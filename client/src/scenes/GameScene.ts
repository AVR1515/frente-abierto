import * as PIXI from "pixi.js";
import type { Room } from "colyseus.js";
import {
  INPUT_SEND_RATE_HZ,
  MAP_WIDTH,
  MAP_HEIGHT,
  PLAYER_RADIUS,
  PROJECTILE_RADIUS,
  CLASSES,
  findEvolutionChoice,
  xpRequiredForLevel,
  STARTING_TICKETS,
  VEHICLES,
  VEHICLE_ENTER_RADIUS,
  findVehicleEvolutionChoice,
  vehicleXpRequiredForLevel,
  VehicleType,
  getEffectiveStats,
} from "shared";
import {
  showEvolutionChoice,
  showMatchEnd,
  updateCommanderPanel,
  updateHud,
  updateTickets,
  updateVehicleHint,
} from "../ui/overlay";

interface RemoteVisual {
  container: PIXI.Container;
  graphic: PIXI.Graphics;
  hpBar: PIXI.Graphics;
  levelText: PIXI.Text;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  toRotation: number;
  lastUpdate: number;
  team: string;
}

interface ProjectileVisual {
  graphic: PIXI.Graphics;
}

interface ControlPointVisual {
  graphic: PIXI.Graphics;
  x: number;
  y: number;
  radius: number;
}

interface VehicleVisual {
  container: PIXI.Container;
  chassis: PIXI.Graphics;
  turret: PIXI.Graphics;
  hpBar: PIXI.Graphics;
  levelText: PIXI.Text;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  toChassisRotation: number;
  toTurretRotation: number;
  lastUpdate: number;
}

const INTERP_DURATION_MS = 1000 / 20; // aprox. la tasa de sync del servidor
const TEAM_COLORS: Record<string, number> = { red: 0xef5350, blue: 0x42a5f5, neutral: 0x9e9e9e };

export class GameScene {
  private app: PIXI.Application;
  private worldContainer = new PIXI.Container();
  private visuals = new Map<string, RemoteVisual>();
  private projectileVisuals = new Map<string, ProjectileVisual>();
  private controlPointVisuals = new Map<string, ControlPointVisual>();
  private vehicleVisuals = new Map<string, VehicleVisual>();
  private localSessionId: string;
  private localVehicleId = "";
  private localTeam = "red";

  private keys = { w: false, a: false, s: false, d: false };
  private mouseScreen = { x: 0, y: 0 };
  private inputSeq = 0;
  private evolutionPromptShownForLevel = 0;
  private vehicleEvolutionPromptShownFor = "";
  private matchEndShown = false;

  private minimapCanvas = document.getElementById("minimap") as HTMLCanvasElement;
  private minimapCtx = this.minimapCanvas.getContext("2d")!;
  private isCommander: boolean;
  private strikeMarkers: { x: number; y: number; graphic: PIXI.Graphics; impactAt: number }[] = [];

  // Predicción del cliente (Fase 8): el jugador local se mueve de inmediato al presionar
  // una tecla, sin esperar al servidor, y se reconcilia cuando llega la corrección.
  private predictedX = 0;
  private predictedY = 0;
  private pendingInputs: { seq: number; moveX: number; moveY: number; dt: number }[] = [];

  constructor(
    private room: Room,
    canvasParent: HTMLElement,
    options: { isCommander: boolean } = { isCommander: false }
  ) {
    this.localSessionId = room.sessionId;
    this.isCommander = options.isCommander;

    this.app = new PIXI.Application({
      resizeTo: window,
      backgroundColor: 0x1a1a1a,
      antialias: true,
    });
    canvasParent.appendChild(this.app.view as HTMLCanvasElement);

    this.app.stage.addChild(this.worldContainer);
    this.drawMapBounds();

    this.setupInput();
    this.setupNetworkListeners();

    this.app.ticker.add(() => this.onRenderTick());
    setInterval(() => this.sendInput(), 1000 / INPUT_SEND_RATE_HZ);
  }

  private drawMapBounds() {
    const bounds = new PIXI.Graphics();
    bounds.lineStyle(4, 0x444444, 1);
    bounds.drawRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
    this.worldContainer.addChild(bounds);
  }

  private setupInput() {
    window.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "e") {
        this.handleVehicleInteractKey();
        return;
      }
      this.onKey(e, true);
    });
    window.addEventListener("keyup", (e) => this.onKey(e, false));
    window.addEventListener("mousemove", (e) => {
      this.mouseScreen.x = e.clientX;
      this.mouseScreen.y = e.clientY;
    });
    window.addEventListener("mousedown", (e) => {
      if (e.button === 2 && this.isCommander) {
        const worldX = this.mouseScreen.x - this.worldContainer.x;
        const worldY = this.mouseScreen.y - this.worldContainer.y;
        this.room.send("commanderStrike", { x: worldX, y: worldY });
        return;
      }
      if (e.button !== 0) return;
      if (this.localVehicleId) {
        this.room.send("vehicleShoot", { angle: this.currentAimAngle() });
      } else {
        this.room.send("shoot", { angle: this.currentAimAngle() });
      }
    });
    if (this.isCommander) {
      window.addEventListener("contextmenu", (e) => e.preventDefault());
    }
  }

  private handleVehicleInteractKey() {
    if (this.localVehicleId) {
      this.room.send("exitVehicle", {});
      return;
    }

    const nearest = this.findNearestEnterableVehicle();
    if (nearest) this.room.send("enterVehicle", { vehicleId: nearest });
  }

  private findNearestEnterableVehicle(): string | null {
    if (!this.visuals.has(this.localSessionId)) return null;

    // usa la posición PREDICHA (Fase 8), no la última confirmada por el servidor,
    // para que la detección de cercanía coincida con lo que el jugador ve en pantalla
    const localX = this.predictedX;
    const localY = this.predictedY;

    let closestId: string | null = null;
    let closestDist = Infinity;

    this.room.state.vehicles.forEach((vehicle: any, id: string) => {
      if (vehicle.destroyed || vehicle.driverSessionId || vehicle.team !== this.localTeam) return;
      const dist = Math.hypot(vehicle.x - localX, vehicle.y - localY);
      if (dist <= VEHICLE_ENTER_RADIUS && dist < closestDist) {
        closestDist = dist;
        closestId = id;
      }
    });

    return closestId;
  }

  private currentAimAngle(): number {
    const screenCenterX = this.app.screen.width / 2;
    const screenCenterY = this.app.screen.height / 2;
    return Math.atan2(this.mouseScreen.y - screenCenterY, this.mouseScreen.x - screenCenterX);
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    switch (e.key.toLowerCase()) {
      case "w":
        this.keys.w = down;
        break;
      case "a":
        this.keys.a = down;
        break;
      case "s":
        this.keys.s = down;
        break;
      case "d":
        this.keys.d = down;
        break;
    }
  }

  private setupNetworkListeners() {
    this.room.state.controlPoints.onAdd((cp: any) => {
      const graphic = new PIXI.Graphics();
      graphic.x = cp.x;
      graphic.y = cp.y;
      this.worldContainer.addChildAt(graphic, 1); // por encima del borde del mapa, debajo de jugadores

      const visual: ControlPointVisual = { graphic, x: cp.x, y: cp.y, radius: cp.radius };
      this.controlPointVisuals.set(cp.id, visual);
      this.drawControlPoint(visual, cp);

      cp.onChange(() => this.drawControlPoint(visual, cp));
    });

    this.room.state.vehicles.onAdd((vehicle: any, id: string) => {
      const def = VEHICLES[vehicle.vehicleType as VehicleType];

      const chassis = new PIXI.Graphics();
      const turret = new PIXI.Graphics();
      const hpBar = new PIXI.Graphics();
      hpBar.y = -def.radius - 18;
      const levelText = new PIXI.Text(`Nv.${vehicle.level}`, { fontSize: 12, fill: 0xffffff, fontFamily: "sans-serif" });
      levelText.anchor.set(0.5, 1);
      levelText.y = -def.radius - 22;

      const container = new PIXI.Container();
      container.addChild(chassis, turret, hpBar, levelText);
      container.x = vehicle.x;
      container.y = vehicle.y;
      this.worldContainer.addChild(container);

      const visual: VehicleVisual = {
        container,
        chassis,
        turret,
        hpBar,
        levelText,
        fromX: vehicle.x,
        fromY: vehicle.y,
        toX: vehicle.x,
        toY: vehicle.y,
        toChassisRotation: vehicle.chassisRotation,
        toTurretRotation: vehicle.turretRotation,
        lastUpdate: performance.now(),
      };
      this.vehicleVisuals.set(id, visual);
      this.drawVehicle(visual, vehicle);

      vehicle.onChange(() => {
        visual.fromX = visual.container.x;
        visual.fromY = visual.container.y;
        visual.toX = vehicle.x;
        visual.toY = vehicle.y;
        visual.toChassisRotation = vehicle.chassisRotation;
        visual.toTurretRotation = vehicle.turretRotation;
        visual.lastUpdate = performance.now();
        this.drawVehicle(visual, vehicle);

        if (vehicle.driverSessionId === this.localSessionId) {
          this.updateLocalHud();

          if (
            vehicle.pendingEvolutionLevel !== 0 &&
            this.vehicleEvolutionPromptShownFor !== `${id}:${vehicle.pendingEvolutionLevel}`
          ) {
            this.vehicleEvolutionPromptShownFor = `${id}:${vehicle.pendingEvolutionLevel}`;
            const choice = findVehicleEvolutionChoice(vehicle.vehicleType as VehicleType, vehicle.pendingEvolutionLevel);
            if (choice) {
              showEvolutionChoice(choice.options, (optionId) => {
                this.room.send("vehicleEvolve", { optionId });
              });
            }
          }
        }
      });
    });

    this.room.state.players.onAdd((player: any, sessionId: string) => {
      const isLocal = sessionId === this.localSessionId;
      if (isLocal) {
        this.localTeam = player.team;
        this.predictedX = player.x;
        this.predictedY = player.y;
      }

      const graphic = new PIXI.Graphics();
      this.drawPlayerShape(graphic, TEAM_COLORS[player.team] ?? 0xffffff, isLocal);
      this.scalePlayerGraphic(graphic, player.level);

      const hpBar = new PIXI.Graphics();
      hpBar.y = -PLAYER_RADIUS - 18;

      const levelText = new PIXI.Text(`Nv.${player.level}`, {
        fontSize: 12,
        fill: 0xffffff,
        fontFamily: "sans-serif",
      });
      levelText.anchor.set(0.5, 1);
      levelText.y = -PLAYER_RADIUS - 22;

      const container = new PIXI.Container();
      container.addChild(graphic);
      container.addChild(hpBar);
      container.addChild(levelText);
      container.x = player.x;
      container.y = player.y;
      this.worldContainer.addChild(container);

      const visual: RemoteVisual = {
        container,
        graphic,
        hpBar,
        levelText,
        fromX: player.x,
        fromY: player.y,
        toX: player.x,
        toY: player.y,
        toRotation: player.rotation,
        lastUpdate: performance.now(),
        team: player.team,
      };
      this.visuals.set(sessionId, visual);
      this.drawHpBar(visual, player.hp, player.maxHp);

      player.onChange(() => {
        visual.fromX = visual.container.x;
        visual.fromY = visual.container.y;
        visual.toX = player.x;
        visual.toY = player.y;
        visual.toRotation = player.rotation;
        visual.lastUpdate = performance.now();
        this.drawHpBar(visual, player.hp, player.maxHp);
        visual.container.visible = !player.vehicleId;

        if (visual.levelText.text !== `Nv.${player.level}`) {
          visual.levelText.text = `Nv.${player.level}`;
          this.drawPlayerShape(visual.graphic, TEAM_COLORS[player.team] ?? 0xffffff, isLocal);
          this.scalePlayerGraphic(visual.graphic, player.level);
        }

        if (isLocal) {
          this.localVehicleId = player.vehicleId;
          this.updateLocalHud();
          this.reconcileLocalPrediction(player);

          if (player.pendingEvolutionLevel !== 0 && this.evolutionPromptShownForLevel !== player.pendingEvolutionLevel) {
            this.evolutionPromptShownForLevel = player.pendingEvolutionLevel;
            const choice = findEvolutionChoice(player.classId, player.pendingEvolutionLevel);
            if (choice) {
              showEvolutionChoice(choice.options, (optionId) => {
                this.room.send("evolve", { optionId });
              });
            }
          }
        }
      });

      if (isLocal) this.updateLocalHud();
    });

    this.room.state.players.onRemove((_player: any, sessionId: string) => {
      const visual = this.visuals.get(sessionId);
      if (visual) {
        this.worldContainer.removeChild(visual.container);
        visual.container.destroy({ children: true });
        this.visuals.delete(sessionId);
      }
    });

    this.room.state.projectiles.onAdd((projectile: any, id: string) => {
      const graphic = new PIXI.Graphics();
      graphic.beginFill(0xffee58);
      graphic.drawCircle(0, 0, PROJECTILE_RADIUS);
      graphic.endFill();
      graphic.x = projectile.x;
      graphic.y = projectile.y;
      this.worldContainer.addChild(graphic);
      this.projectileVisuals.set(id, { graphic });

      projectile.onChange(() => {
        graphic.x = projectile.x;
        graphic.y = projectile.y;
      });
    });

    this.room.state.projectiles.onRemove((_projectile: any, id: string) => {
      const visual = this.projectileVisuals.get(id);
      if (visual) {
        this.worldContainer.removeChild(visual.graphic);
        visual.graphic.destroy();
        this.projectileVisuals.delete(id);
      }
    });

    this.room.onMessage("hit", (message: { sessionId?: string; vehicleId?: string; x: number; y: number }) => {
      if (message.sessionId) {
        const visual = this.visuals.get(message.sessionId);
        if (visual) {
          visual.graphic.tint = 0xff0000;
          setTimeout(() => (visual.graphic.tint = 0xffffff), 100);
        }
      } else if (message.vehicleId) {
        const visual = this.vehicleVisuals.get(message.vehicleId);
        if (visual) {
          visual.chassis.tint = 0xff0000;
          setTimeout(() => (visual.chassis.tint = 0xffffff), 100);
        }
      }
    });

    this.room.onMessage("matchEnded", (message: { winningTeam: string }) => {
      if (this.matchEndShown) return;
      this.matchEndShown = true;
      showMatchEnd(message.winningTeam);
    });

    this.room.onStateChange(() => {
      updateTickets(
        this.room.state.redTickets,
        this.room.state.blueTickets,
        this.room.state.matchTimeRemaining,
        STARTING_TICKETS
      );

      if (this.isCommander) {
        updateCommanderPanel(this.room.state.commandPoints, () => {
          this.room.send("commanderAddPoints", {});
        });
      }
    });

    this.room.onMessage("commanderStrikeTelegraph", (message: { x: number; y: number }) => {
      const graphic = new PIXI.Graphics();
      graphic.lineStyle(3, 0xffeb3b, 0.9);
      graphic.drawCircle(0, 0, 150);
      graphic.x = message.x;
      graphic.y = message.y;
      this.worldContainer.addChild(graphic);
      this.strikeMarkers.push({ x: message.x, y: message.y, graphic, impactAt: performance.now() + 1200 });
    });

    this.room.onMessage("commanderStrikeImpact", (message: { x: number; y: number }) => {
      const flash = new PIXI.Graphics();
      flash.beginFill(0xff9800, 0.6);
      flash.drawCircle(0, 0, 150);
      flash.endFill();
      flash.x = message.x;
      flash.y = message.y;
      this.worldContainer.addChild(flash);
      setTimeout(() => {
        this.worldContainer.removeChild(flash);
        flash.destroy();
      }, 300);

      const marker = this.strikeMarkers.find((m) => m.x === message.x && m.y === message.y);
      if (marker) {
        this.worldContainer.removeChild(marker.graphic);
        marker.graphic.destroy();
        this.strikeMarkers = this.strikeMarkers.filter((m) => m !== marker);
      }
    });
  }

  private updateLocalHud() {
    const player = this.room.state.players.get(this.localSessionId) as any;
    if (!player) return;

    if (player.vehicleId) {
      const vehicle = this.room.state.vehicles.get(player.vehicleId) as any;
      if (vehicle) {
        const def = VEHICLES[vehicle.vehicleType as VehicleType];
        updateHud(
          `Equipo: ${player.team === "red" ? "Rojo" : "Azul"} — Vehículo: ${def.name} — Nivel ${vehicle.level} — XP ${vehicle.xp}/${vehicleXpRequiredForLevel(vehicle.level)} — HP ${Math.ceil(vehicle.hp)}/${vehicle.maxHp}`
        );
        return;
      }
    }

    updateHud(
      `Equipo: ${player.team === "red" ? "Rojo" : "Azul"} — Clase: ${CLASSES[player.classId]?.name ?? player.classId} — Nivel ${player.level} — XP ${player.xp}/${xpRequiredForLevel(player.level)} — HP ${player.hp}/${player.maxHp}`
    );
  }

  private drawPlayerShape(graphic: PIXI.Graphics, color: number, isLocal: boolean) {
    graphic.clear();
    if (isLocal) graphic.lineStyle(2, 0xffffff, 1);
    graphic.beginFill(color);
    graphic.moveTo(PLAYER_RADIUS, 0);
    graphic.lineTo(-PLAYER_RADIUS * 0.7, -PLAYER_RADIUS * 0.7);
    graphic.lineTo(-PLAYER_RADIUS * 0.7, PLAYER_RADIUS * 0.7);
    graphic.closePath();
    graphic.endFill();
  }

  private drawHpBar(visual: RemoteVisual, hp: number, maxHp: number) {
    const width = PLAYER_RADIUS * 2;
    const ratio = Math.max(0, hp / Math.max(1, maxHp));
    visual.hpBar.clear();
    visual.hpBar.beginFill(0x222222);
    visual.hpBar.drawRect(-width / 2, 0, width, 4);
    visual.hpBar.endFill();
    visual.hpBar.beginFill(ratio > 0.4 ? 0x4caf50 : 0xf44336);
    visual.hpBar.drawRect(-width / 2, 0, width * ratio, 4);
    visual.hpBar.endFill();
  }

  private scalePlayerGraphic(graphic: PIXI.Graphics, level: number) {
    const scale = 1 + Math.min(level - 1, 10) * 0.08;
    graphic.scale.set(scale);
  }

  private drawControlPoint(visual: ControlPointVisual, cp: any) {
    const color = TEAM_COLORS[cp.ownerTeam] ?? TEAM_COLORS.neutral;
    visual.graphic.clear();
    visual.graphic.lineStyle(3, color, 1);
    visual.graphic.beginFill(color, 0.12);
    visual.graphic.drawCircle(0, 0, cp.radius);
    visual.graphic.endFill();

    // indicador de progreso de captura como arco
    const progress = (cp.captureValue + 1) / 2; // 0 (rojo total) .. 1 (azul total)
    visual.graphic.lineStyle(6, 0xffffff, 0.6);
    visual.graphic.arc(0, 0, cp.radius + 10, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
  }

  private drawVehicle(visual: VehicleVisual, vehicle: any) {
    const def = VEHICLES[vehicle.vehicleType as VehicleType];
    const color = TEAM_COLORS[vehicle.team] ?? 0xffffff;

    visual.chassis.clear();
    visual.chassis.alpha = vehicle.destroyed ? 0.25 : 1;
    visual.chassis.beginFill(color);
    visual.chassis.drawRoundedRect(-def.radius, -def.radius * 0.65, def.radius * 2, def.radius * 1.3, 6);
    visual.chassis.endFill();

    visual.turret.clear();
    visual.turret.visible = !vehicle.destroyed;
    if (def.hasTurret) {
      visual.turret.beginFill(0x333333);
      visual.turret.drawRect(0, -4, def.radius * 1.1, 8);
      visual.turret.endFill();
      visual.turret.rotation = vehicle.turretRotation;
    }

    visual.hpBar.visible = !vehicle.destroyed;
    const width = def.radius * 2;
    const ratio = Math.max(0, vehicle.hp / Math.max(1, vehicle.maxHp));
    visual.hpBar.clear();
    visual.hpBar.beginFill(0x222222);
    visual.hpBar.drawRect(-width / 2, 0, width, 4);
    visual.hpBar.endFill();
    visual.hpBar.beginFill(ratio > 0.4 ? 0x4caf50 : 0xf44336);
    visual.hpBar.drawRect(-width / 2, 0, width * ratio, 4);
    visual.hpBar.endFill();

    visual.levelText.visible = !vehicle.destroyed;
    visual.levelText.text = `Nv.${vehicle.level}`;
  }

  private sendInput() {
    let moveX = 0;
    let moveY = 0;
    if (this.keys.w) moveY -= 1;
    if (this.keys.s) moveY += 1;
    if (this.keys.a) moveX -= 1;
    if (this.keys.d) moveX += 1;

    const seq = this.inputSeq++;
    this.room.send("input", {
      moveX,
      moveY,
      angle: this.currentAimAngle(),
      seq,
    });

    if (!this.localVehicleId) {
      const dt = 1 / INPUT_SEND_RATE_HZ;
      this.pendingInputs.push({ seq, moveX, moveY, dt });
      this.applyMovement(moveX, moveY, dt);
    }
  }

  /** Simula localmente el mismo movimiento que aplica el servidor, para responsividad inmediata. */
  private applyMovement(moveX: number, moveY: number, dt: number) {
    const player = this.room.state.players.get(this.localSessionId) as any;
    if (!player) return;

    const stats = getEffectiveStats(player.classId, Array.from(player.chosenEvolutions) as string[]);
    const magnitude = Math.min(1, Math.hypot(moveX, moveY));
    const angle = Math.atan2(moveY, moveX);
    const dx = Math.cos(angle) * magnitude * stats.speed * dt;
    const dy = Math.sin(angle) * magnitude * stats.speed * dt;

    this.predictedX = clampCoord(this.predictedX + dx, PLAYER_RADIUS, MAP_WIDTH - PLAYER_RADIUS);
    this.predictedY = clampCoord(this.predictedY + dy, PLAYER_RADIUS, MAP_HEIGHT - PLAYER_RADIUS);
  }

  /** Reconciliación: parte de la posición confirmada por el servidor y reaplica los inputs aún no confirmados. */
  private reconcileLocalPrediction(player: any) {
    if (player.vehicleId) return;

    this.pendingInputs = this.pendingInputs.filter((input) => input.seq > player.lastProcessedSeq);

    this.predictedX = player.x;
    this.predictedY = player.y;
    for (const input of this.pendingInputs) {
      this.applyMovement(input.moveX, input.moveY, input.dt);
    }
  }

  private onRenderTick() {
    const now = performance.now();

    this.visuals.forEach((visual, sessionId) => {
      if (sessionId === this.localSessionId && !this.localVehicleId) {
        // el jugador local se renderiza en su posición predicha, no interpolada (Fase 8)
        visual.container.x = this.predictedX;
        visual.container.y = this.predictedY;
        visual.graphic.rotation = visual.toRotation;
        return;
      }

      const t = Math.min(1, (now - visual.lastUpdate) / INTERP_DURATION_MS);
      visual.container.x = lerp(visual.fromX, visual.toX, t);
      visual.container.y = lerp(visual.fromY, visual.toY, t);
      visual.graphic.rotation = visual.toRotation;
    });

    this.vehicleVisuals.forEach((visual) => {
      const t = Math.min(1, (now - visual.lastUpdate) / INTERP_DURATION_MS);
      visual.container.x = lerp(visual.fromX, visual.toX, t);
      visual.container.y = lerp(visual.fromY, visual.toY, t);
      visual.chassis.rotation = visual.toChassisRotation;
      if (visual.turret.visible) visual.turret.rotation = visual.toTurretRotation;
    });

    if (this.localVehicleId) {
      const drivenVehicle = this.vehicleVisuals.get(this.localVehicleId);
      if (drivenVehicle) {
        this.worldContainer.x = this.app.screen.width / 2 - drivenVehicle.container.x;
        this.worldContainer.y = this.app.screen.height / 2 - drivenVehicle.container.y;
      }
    } else {
      this.worldContainer.x = this.app.screen.width / 2 - this.predictedX;
      this.worldContainer.y = this.app.screen.height / 2 - this.predictedY;
    }

    this.updateVehicleHint();
    this.drawMinimap();
  }

  private updateVehicleHint() {
    if (this.localVehicleId) {
      updateVehicleHint("Presioná E para bajar del vehículo");
      return;
    }

    const nearestId = this.findNearestEnterableVehicle();
    if (nearestId) {
      const vehicle = this.room.state.vehicles.get(nearestId) as any;
      const def = VEHICLES[vehicle.vehicleType as VehicleType];
      const stationaryNote = def.id === "artillery" ? " (estacionaria, solo gira la torreta)" : "";
      updateVehicleHint(`Presioná E para subir al ${def.name}${stationaryNote}`);
    } else {
      updateVehicleHint(null);
    }
  }

  private drawMinimap() {
    const ctx = this.minimapCtx;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    const scaleX = w / MAP_WIDTH;
    const scaleY = h / MAP_HEIGHT;

    ctx.clearRect(0, 0, w, h);

    this.controlPointVisuals.forEach((cpVisual, id) => {
      const cp = (this.room.state.controlPoints as any).get(id);
      if (!cp) return;
      ctx.beginPath();
      ctx.fillStyle = cp.ownerTeam === "red" ? "#ef5350" : cp.ownerTeam === "blue" ? "#42a5f5" : "#9e9e9e";
      ctx.arc(cpVisual.x * scaleX, cpVisual.y * scaleY, 5, 0, Math.PI * 2);
      ctx.fill();
    });

    this.visuals.forEach((visual, sessionId) => {
      ctx.beginPath();
      ctx.fillStyle = visual.team === "red" ? "#ef5350" : "#42a5f5";
      ctx.arc(visual.container.x * scaleX, visual.container.y * scaleY, sessionId === this.localSessionId ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
      if (sessionId === this.localSessionId) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    });
  }
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function clampCoord(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
