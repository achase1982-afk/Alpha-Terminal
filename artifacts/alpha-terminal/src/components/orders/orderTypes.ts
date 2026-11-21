export type OrderFilter = "ALL" | "WORKING" | "FILLED" | "CANCELED" | "REJECTED";

export interface PortfolioOrder {
  orderId: number;
  orderType: string;
  session: string;
  duration: string;
  status: string;
  filledQuantity: number;
  remainingQuantity: number;
  price: number | null;
  complexStrategy: string;
  enteredTime: string;
  closeTime: string | null;
  legs: {
    instruction: string;
    quantity: number;
    symbol: string;
    underlyingSymbol: string;
    assetType: string;
    putCall: string | null;
    description: string;
  }[];
  fills: { legId: number; price: number; quantity: number; time: string }[];
  tag: string | null;
}

export const ORDER_FILTERS: { value: OrderFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "WORKING", label: "Open" },
  { value: "FILLED", label: "Filled" },
  { value: "CANCELED", label: "Canceled" },
  { value: "REJECTED", label: "Rejected" },
];