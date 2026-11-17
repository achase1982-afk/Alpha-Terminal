import { deskStreamerSyncDeskSymbols } from "./deskStreamerDeskSync.js";

export type DeskStreamerWireCommand = {
  service: "LEVELONE_EQUITIES" | "LEVELONE_OPTIONS" | "OPTIONS_BOOK";
  command: "ADD" | "UNSUBS";
  keys: string[];
};

export function wireCommandsForDeskOptions(
  symbols: string[],
  deskAdded: ReadonlySet<string>,
  appHeld: ReadonlySet<string>,
  budget: number,
): { commands: DeskStreamerWireCommand[]; nextDesk: string[] } {
  const sync = deskStreamerSyncDeskSymbols(deskAdded, symbols, budget, appHeld);
  const commands: DeskStreamerWireCommand[] = [];
  if (sync.unsub.length > 0) {
    commands.push({ service: "LEVELONE_OPTIONS", command: "UNSUBS", keys: [...sync.unsub] });
  }
  if (sync.add.length > 0) {
    commands.push({ service: "LEVELONE_OPTIONS", command: "ADD", keys: [...sync.add] });
  }
  return { commands, nextDesk: sync.next };
}

export function wireCommandsForDeskOptionsBook(
  symbols: string[],
  deskAdded: ReadonlySet<string>,
  appHeld: ReadonlySet<string>,
  budget: number,
): { commands: DeskStreamerWireCommand[]; nextDesk: string[] } {
  const sync = deskStreamerSyncDeskSymbols(deskAdded, symbols, budget, appHeld);
  const commands: DeskStreamerWireCommand[] = [];
  if (sync.unsub.length > 0) {
    commands.push({ service: "OPTIONS_BOOK", command: "UNSUBS", keys: [...sync.unsub] });
  }
  if (sync.add.length > 0) {
    commands.push({ service: "OPTIONS_BOOK", command: "ADD", keys: [...sync.add] });
  }
  return { commands, nextDesk: sync.next };
}

/** After app LEVELONE_EQUITIES SUBS replacement, re-ADD desk equities. */
export function wireCommandsReplayDeskEquities(deskAddedEquities: string[]): DeskStreamerWireCommand[] {
  if (!deskAddedEquities.length) return [];
  return [{ service: "LEVELONE_EQUITIES", command: "ADD", keys: [...deskAddedEquities] }];
}

/** Full desk replay (login path): one batch per service. */
export function wireCommandsReplayAllDesk(symbols: {
  equities: string[];
  leveloneOptions: string[];
  optionsBook: string[];
}): DeskStreamerWireCommand[] {
  const out: DeskStreamerWireCommand[] = [];
  if (symbols.equities.length) {
    out.push({ service: "LEVELONE_EQUITIES", command: "ADD", keys: [...symbols.equities] });
  }
  if (symbols.leveloneOptions.length) {
    out.push({ service: "LEVELONE_OPTIONS", command: "ADD", keys: [...symbols.leveloneOptions] });
  }
  if (symbols.optionsBook.length) {
    out.push({ service: "OPTIONS_BOOK", command: "ADD", keys: [...symbols.optionsBook] });
  }
  return out;
}
