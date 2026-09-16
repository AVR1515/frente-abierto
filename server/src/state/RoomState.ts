import { Schema, MapSchema, type } from "@colyseus/schema";
import { Player } from "./Player";
import { Projectile } from "./Projectile";
import { ControlPoint } from "./ControlPoint";
import { Vehicle } from "./Vehicle";

export class RoomState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Projectile }) projectiles = new MapSchema<Projectile>();
  @type({ map: ControlPoint }) controlPoints = new MapSchema<ControlPoint>();
  @type({ map: Vehicle }) vehicles = new MapSchema<Vehicle>();

  @type("number") redTickets = 0;
  @type("number") blueTickets = 0;
  @type("number") matchTimeRemaining = 0;
  @type("boolean") matchEnded = false;
  @type("string") winningTeam = ""; // "red" | "blue" | "draw" | ""

  @type("string") roomCode = "";
  @type("string") streamerName = "";
  @type("number") commandPoints = 0;
}
