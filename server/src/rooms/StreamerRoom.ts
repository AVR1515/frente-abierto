import { Client } from "colyseus";
import { GameRoom } from "./GameRoom";
import {
  COMMANDER_STRIKE_COST,
  COMMANDER_STRIKE_DAMAGE,
  COMMANDER_STRIKE_RADIUS,
  COMMANDER_STRIKE_DELAY_MS,
  COMMANDER_MAX_POINTS,
  normalizeDisplayName,
} from "shared";

interface StreamerRoomOptions {
  roomCode: string;
  streamerName: string;
  friendlyFire?: boolean;
  whitelist?: string[];
  displayName?: string;
  isStreamer?: boolean;
  classId?: string;
}

interface ClientAuth {
  displayName: string;
  isStreamer: boolean;
}

/**
 * Sala privada para streamers (Fase 7). La verificación de identidad hoy es una whitelist
 * manual de nombres de usuario en memoria — el punto de reemplazo por el login OAuth real de
 * Twitch y la verificación de subs vía la API Helix es `onAuth` más abajo.
 */
export class StreamerRoom extends GameRoom {
  private roomCode = "";
  private streamerName = "";
  private whitelist = new Set<string>();
  private commanderSessionId = "";

  onCreate(options?: StreamerRoomOptions) {
    super.onCreate();

    this.roomCode = options?.roomCode ?? "";
    this.streamerName = options?.streamerName ?? "";
    this.friendlyFire = !!options?.friendlyFire;

    (options?.whitelist ?? []).forEach((name) => this.whitelist.add(normalizeDisplayName(name)));
    this.whitelist.add(normalizeDisplayName(this.streamerName));

    this.state.roomCode = this.roomCode;
    this.state.streamerName = this.streamerName;
    this.state.commandPoints = 0;

    this.setMetadata({ roomCode: this.roomCode, streamerName: this.streamerName });

    this.onMessage("addToWhitelist", (client: Client, message: { username: string }) => {
      if (client.sessionId !== this.commanderSessionId) return;
      const name = normalizeDisplayName(message.username ?? "");
      if (name) this.whitelist.add(name);
    });

    this.onMessage("commanderAddPoints", (client: Client) => {
      // Marcador temporal de "sub/bit" hasta conectar el webhook real de Twitch EventSub.
      if (client.sessionId !== this.commanderSessionId) return;
      this.state.commandPoints = Math.min(COMMANDER_MAX_POINTS, this.state.commandPoints + 1);
    });

    this.onMessage("commanderStrike", (client: Client, message: { x: number; y: number }) => {
      this.handleCommanderStrike(client, message.x, message.y);
    });
  }

  async onAuth(_client: Client, options: StreamerRoomOptions): Promise<ClientAuth | false> {
    const name = normalizeDisplayName(options.displayName ?? "");
    if (!name) return false;

    if (options.isStreamer) {
      if (name !== normalizeDisplayName(this.streamerName)) return false;
      return { displayName: name, isStreamer: true };
    }

    if (!this.whitelist.has(name)) return false;
    return { displayName: name, isStreamer: false };
  }

  onJoin(client: Client, options: StreamerRoomOptions) {
    super.onJoin(client, options);

    const auth = client.auth as ClientAuth | undefined;
    if (auth?.isStreamer) this.commanderSessionId = client.sessionId;
  }

  onLeave(client: Client) {
    super.onLeave(client);
    if (client.sessionId === this.commanderSessionId) this.commanderSessionId = "";
  }

  private handleCommanderStrike(client: Client, x: number, y: number) {
    if (client.sessionId !== this.commanderSessionId) return;
    if (this.state.commandPoints < COMMANDER_STRIKE_COST) return;

    const commander = this.state.players.get(client.sessionId);
    if (!commander) return;

    this.state.commandPoints -= COMMANDER_STRIKE_COST;
    this.broadcast("commanderStrikeTelegraph", { x, y });

    setTimeout(() => {
      if (this.state.matchEnded) return;
      this.applyAreaDamage(x, y, COMMANDER_STRIKE_RADIUS, COMMANDER_STRIKE_DAMAGE, commander.team);
      this.broadcast("commanderStrikeImpact", { x, y });
    }, COMMANDER_STRIKE_DELAY_MS);
  }
}
