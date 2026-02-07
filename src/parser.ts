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
}

export function parseSlainLine(line: string): SlainMatch | null {
  // [PVP] + has killed + npc (optional " in <zone>")
  const pvpRegex =
    /\[PVP\]\s+(?<killer>.+?)\s+has killed\s+(?<npc>.+?)(?:\s+in\s+(?<zone>.+?))?!$/;
  const pvpMatch = line.match(pvpRegex);
  if (pvpMatch?.groups?.npc) {
    const npcName = pvpMatch.groups.npc.trim();
    const zone = pvpMatch.groups.zone?.trim();
    return {
      npcName,
      ...(zone ? { zone } : {}),
      pvp: 1,
      killedAt: new Date(),
    };
  }

  // Guild instance: <someone> tells the guild, '<killer> of <guild> has killed <npc> in <zone>!'
  // This is NOT PvP (guild instances are not PvP)
  const guildRegex =
    /.+?\s+tells the guild,\s+'(?<killer>.+?)\s+of\s+<.+?>\s+has killed\s+(?<npc>.+?)(?:\s+in\s+(?<zone>.+?))?!'/;
  const guildMatch = line.match(guildRegex);
  if (guildMatch?.groups?.npc) {
    const npcName = guildMatch.groups.npc.trim();
    const zone = guildMatch.groups.zone?.trim();
    return {
      npcName,
      ...(zone ? { zone } : {}),
      pvp: 0,
      killedAt: new Date(),
    };
  }

  // <npc> has been slain by <killer>!
  const slainByRegex = /(?<npc>.+?)\s+has been slain by\s+(?<killer>.+?)!?\s*$/;
  const slainByMatch = line.match(slainByRegex);
  if (slainByMatch?.groups?.npc) {
    const npcName = slainByMatch.groups.npc.trim();
    return {
      npcName,
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
