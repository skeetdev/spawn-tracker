/**
 * Duplicate of backend eqParser patterns so the client has no backend dependency.
 * Matches: [PVP] <killer> has killed <npc> in <zone>! and You have slain <npc>.
 */
export interface SlainMatch {
  npcName: string;
  zone?: string;
  pvp: number;
  killedAt: Date;
}

export function parseSlainLine(line: string): SlainMatch | null {
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
