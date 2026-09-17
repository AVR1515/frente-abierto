import { Client, Room } from "colyseus.js";
import type { InputMessage } from "shared";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";

export class NetworkManager {
  private client = new Client(SERVER_URL);
  room: Room | null = null;

  async connect(): Promise<Room> {
    this.room = await this.client.joinOrCreate("game", {});
    console.log("cliente conectado", this.room.sessionId);
    return this.room;
  }

  async createStreamerRoom(opts: {
    roomCode: string;
    streamerName: string;
    friendlyFire: boolean;
    whitelist: string[];
  }): Promise<Room> {
    this.room = await this.client.create("streamer_game", {
      ...opts,
      displayName: opts.streamerName,
      isStreamer: true,
    });
    console.log("sala de streamer creada", this.room.sessionId);
    return this.room;
  }

  async joinStreamerRoom(roomCode: string, displayName: string): Promise<Room> {
    this.room = await this.client.join("streamer_game", { roomCode, displayName });
    console.log("cliente conectado a sala de streamer", this.room.sessionId);
    return this.room;
  }

  sendInput(input: InputMessage) {
    this.room?.send("input", input);
  }
}
