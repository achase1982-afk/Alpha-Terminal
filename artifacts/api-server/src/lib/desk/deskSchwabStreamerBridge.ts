let statusReader: () => string = () => "disconnected";
let connectedReader: () => boolean = () => false;

export function registerDeskStreamerHealthReaders(
  status: () => string,
  connected: () => boolean,
): void {
  statusReader = status;
  connectedReader = connected;
}

export function deskReadStreamerStatus(): string {
  return statusReader();
}

export function deskReadStreamerConnected(): boolean {
  return connectedReader();
}