import { Schema, type } from "@colyseus/schema";

export class Projectile extends Schema {
  @type("string") ownerId = "";
  @type("string") ownerType = "player"; // "player" | "vehicle"
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") vx = 0;
  @type("number") vy = 0;
  @type("number") spawnedAt = 0;
  @type("number") damage = 0;
}
