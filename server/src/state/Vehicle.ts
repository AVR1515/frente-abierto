import { Schema, ArraySchema, type } from "@colyseus/schema";

export class Vehicle extends Schema {
  @type("string") id = "";
  @type("string") vehicleType = "jeep";
  @type("string") team = "red";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") chassisRotation = 0;
  @type("number") turretRotation = 0;
  @type("number") hp = 0;
  @type("number") maxHp = 0;
  @type("number") level = 1;
  @type("number") xp = 0;
  @type("number") pendingEvolutionLevel = 0;
  @type(["string"]) chosenEvolutions = new ArraySchema<string>();
  @type("string") driverSessionId = "";
  @type("boolean") destroyed = false;
  @type("number") respawnAt = 0;

  spawnX = 0;
  spawnY = 0;
}
