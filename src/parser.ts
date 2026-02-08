/**
 * Duplicate of backend eqParser patterns so the client has no backend dependency.
 * Matches:
 * 1. [PVP] <killer> has killed <npc> in <zone>!
 * 2. Guild instance: <someone> tells the guild, '<killer> of <guild> has killed <npc> in <zone>!'
 * 3. <npc> has been slain by <killer>!
 * 4. You have slain <npc>.
 */
export interface SlainMatch {
  npcName: string;
  zone?: string;
  pvp: number;
  killedAt: Date;
  playerName?: string;
  guildName?: string;
}

export interface EarthquakeMatch {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export function parseSlainLine(line: string): SlainMatch | null {
  // [PVP] + has killed + npc (optional " in <zone>")
  // Can be: "[PVP] Player has killed NPC" or "[PVP] Player of <Guild> has killed NPC in Zone!"
  const pvpRegex =
    /\[PVP\]\s+(?<player>.+?)(?:\s+of\s+<(?<guild>.+?)>)?\s+has killed\s+(?<npc>.+?)(?:\s+in\s+(?<zone>.+?))?!$/;
  const pvpMatch = line.match(pvpRegex);
  if (pvpMatch?.groups?.npc) {
    const npcName = pvpMatch.groups.npc.trim();
    const zone = pvpMatch.groups.zone?.trim();
    const playerName = pvpMatch.groups.player?.trim();
    const guildName = pvpMatch.groups.guild?.trim();
    return {
      npcName,
      ...(zone ? { zone } : {}),
      ...(playerName ? { playerName } : {}),
      ...(guildName ? { guildName } : {}),
      pvp: 1,
      killedAt: new Date(),
    };
  }

  // Guild instance: <someone> tells the guild, '<killer> of <guild> has killed <npc> in <zone>!'
  // This is NOT PvP (guild instances are not PvP)
  const guildRegex =
    /.+?\s+tells the guild,\s+'(?<killer>.+?)\s+of\s+<(?<guild>.+?)>\s+has killed\s+(?<npc>.+?)(?:\s+in\s+(?<zone>.+?))?!'/;
  const guildMatch = line.match(guildRegex);
  if (guildMatch?.groups?.npc) {
    const npcName = guildMatch.groups.npc.trim();
    const zone = guildMatch.groups.zone?.trim();
    const playerName = guildMatch.groups.killer?.trim();
    const guildName = guildMatch.groups.guild?.trim();
    return {
      npcName,
      ...(zone ? { zone } : {}),
      ...(playerName ? { playerName } : {}),
      ...(guildName ? { guildName } : {}),
      pvp: 0,
      killedAt: new Date(),
    };
  }

  // <npc> has been slain by <killer>!
  const slainByRegex = /(?<npc>.+?)\s+has been slain by\s+(?<killer>.+?)!?\s*$/;
  const slainByMatch = line.match(slainByRegex);
  if (slainByMatch?.groups?.npc) {
    const npcName = slainByMatch.groups.npc.trim();
    const playerName = slainByMatch.groups.killer?.trim();
    return {
      npcName,
      ...(playerName ? { playerName } : {}),
      pvp: 0,
      killedAt: new Date(),
    };
  }

  // You have slain <npc>.
  const slainRegex = /You have slain\s+(?<npc>.+?)[.!]?\s*$/;
  const slainMatch = line.match(slainRegex);
  if (slainMatch?.groups?.npc) {
    const npcName = slainMatch.groups.npc.trim();
    return {
      npcName,
      pvp: 0,
      killedAt: new Date(),
    };
  }

  return null;
}

/**
 * Parse earthquake announcement line to extract duration components.
 *
 * Example: "The next earthquake will begin in 3 Days, 20 Hours, 57 Minutes, and 42 Seconds"
 *
 * Returns: { days, hours, minutes, seconds } or null if not a match
 */
export function parseEarthquakeLine(line: string): EarthquakeMatch | null {
  const regex = /The next earthquake will begin in (?:(\d+) Days?,\s*)?(?:(\d+) Hours?,\s*)?(?:(\d+) Minutes?,\s*)?(?:and\s+)?(\d+) Seconds?/i;
  const match = line.match(regex);
  if (!match) return null;

  const days = match[1] ? parseInt(match[1], 10) : 0;
  const hours = match[2] ? parseInt(match[2], 10) : 0;
  const minutes = match[3] ? parseInt(match[3], 10) : 0;
  const seconds = match[4] ? parseInt(match[4], 10) : 0;

  return { days, hours, minutes, seconds };
}
