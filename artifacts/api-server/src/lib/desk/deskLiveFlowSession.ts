import { deskSessionDateEt } from "./deskEt.js";
import { rebaselineL1ContractState } from "./deskLiveFlowClassify.js";

type ContractMap = Map<string, import("./deskLiveFlowClassify.js").ContractFlowState>;

let lastSessionDate = deskSessionDateEt();
let lastConnectionId = -1;

export function deskLiveFlowSessionMarkConnection(connectionId: number): boolean {
  if (connectionId === lastConnectionId) return false;
  lastConnectionId = connectionId;
  return true;
}

export function deskLiveFlowSessionMarkSessionDate(now = new Date()): boolean {
  const d = deskSessionDateEt(now);
  if (d === lastSessionDate) return false;
  lastSessionDate = d;
  return true;
}

export function deskLiveFlowSessionResetContracts(
  contractState: ContractMap,
  opts?: { preserveVolume?: boolean },
): void {
  if (!opts?.preserveVolume) {
    contractState.clear();
    return;
  }
  for (const [key, st] of contractState) {
    contractState.set(key, rebaselineL1ContractState(st.prevVolume));
  }
}

export function deskLiveFlowSessionDropContracts(contractState: ContractMap, keys: string[]): void {
  for (const k of keys) contractState.delete(k);
}

export function deskLiveFlowSessionRebaselineContracts(contractState: ContractMap, keys: string[]): void {
  for (const k of keys) {
    const st = contractState.get(k);
    contractState.set(k, rebaselineL1ContractState(st?.prevVolume ?? null));
  }
}

export function deskLiveFlowSessionResetForTests(): void {
  lastSessionDate = deskSessionDateEt();
  lastConnectionId = -1;
}