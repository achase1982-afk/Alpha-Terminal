/** Live books only. Paper and sandbox books never enter the ledger. */

export function isExcludedBook(input: {
  type?: string | null;
  accountNumber?: string | null;
  environment?: string | null;
  baseUrl?: string | null;
}): boolean {
  const hay = [input.type, input.accountNumber, input.environment, input.baseUrl]
    .filter((part) => typeof part === "string" && part.length > 0)
    .join(" ")
    .toLowerCase();
  return hay.includes("paper") || hay.includes("sandbox");
}

export function brokerEnvironment(): string | null {
  const raw = process.env.BROKER_ENVIRONMENT;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}
