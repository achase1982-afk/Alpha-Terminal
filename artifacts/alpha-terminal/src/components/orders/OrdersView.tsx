import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search, XCircle } from "lucide-react";
import { ConnectBrokerPrompt } from "@/components/ConnectBrokerPrompt";
import { SchwabAccountHeader } from "@/components/SchwabAccountHeader";
import { useTerminalStore } from "@/lib/store";
import { usePortfolioStreamStore } from "@/lib/portfolio-stream-store";
import { useSchwabAccountStore } from "@/lib/schwab-account-store";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useShallow } from "zustand/react/shallow";
import { OrderRow } from "./OrderRow";
import { ORDER_FILTERS, type OrderFilter, type PortfolioOrder } from "./orderTypes";
import { ordersChrome as C, ordersFont as f } from "./ordersTheme";

declare global {
  interface Window {
    __alphaWs?: WebSocket;
  }
}

export function OrdersView() {
  const { accessToken } = useTerminalStore(useShallow((s) => ({ accessToken: s.accessToken })));
  const wsOrders = usePortfolioStreamStore((s) => s.orders);
  const portfolioStatus = usePortfolioStreamStore((s) => s.portfolioStatus);
  const ordersHash = useSchwabAccountStore((s) => s.ordersAccountHash());
  const tradingHash = useSchwabAccountStore((s) => s.tradingAccountHash());
  const multiAccount = useSchwabAccountStore((s) => s.accounts.length) > 1;
  const accountHash = tradingHash ?? ordersHash;

  const [orders, setOrders] = useState<PortfolioOrder[]>(
    () => usePortfolioStreamStore.getState().orders as PortfolioOrder[],
  );
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState(false);
  const [orderFilter, setOrderFilter] = useState<OrderFilter>("ALL");
  const [orderSearch, setOrderSearch] = useState("");

  useEffect(() => {
    if (multiAccount) return;
    if (wsOrders && wsOrders.length > 0) {
      setOrders(wsOrders as PortfolioOrder[]);
      setOrdersLoading(false);
      setOrdersError(false);
    }
  }, [wsOrders, multiAccount]);

  useEffect(() => {
    if (!accessToken) return;
    const sendSubscribe = () => {
      const ws = window.__alphaWs;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: "subscribePortfolio" }));
        return true;
      }
      return false;
    };
    let cleanup: (() => void) | undefined;
    if (!sendSubscribe()) {
      const retry = setInterval(() => {
        if (sendSubscribe()) clearInterval(retry);
      }, 500);
      const timeout = setTimeout(() => clearInterval(retry), 10_000);
      cleanup = () => {
        clearInterval(retry);
        clearTimeout(timeout);
      };
    }
    return () => {
      cleanup?.();
      const ws = window.__alphaWs;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: "unsubscribePortfolio" }));
      }
    };
  }, [accessToken]);

  const fetchOrders = useCallback(async () => {
    const hash = useSchwabAccountStore.getState().ordersAccountHash();
    if (!hash) {
      setOrders([]);
      return;
    }
    setOrdersLoading(true);
    setOrdersError(false);
    try {
      const res = await fetchWithAuth(
        `/api/portfolio/orders?days=30&accountHash=${encodeURIComponent(hash)}`,
      );
      if (!res.ok) throw new Error();
      setOrders(await res.json());
    } catch {
      setOrdersError(true);
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accessToken || !ordersHash) return;
    fetchOrders();
  }, [accessToken, ordersHash, fetchOrders]);

  const handleCancelOrder = useCallback(
    async (orderId: number) => {
      if (!accountHash) return;
      try {
        await fetchWithAuth("/api/portfolio/cancel-order", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountHash, orderId: String(orderId) }),
        });
        fetchOrders();
      } catch {
        /* ignore */
      }
    },
    [accountHash, fetchOrders],
  );

  const filteredOrders = useMemo(() => {
    let list = orders;
    if (orderFilter !== "ALL") list = list.filter((o) => o.status === orderFilter);
    if (orderSearch.trim()) {
      const q = orderSearch.trim().toUpperCase();
      list = list.filter((o) =>
        o.legs.some(
          (l) => l.symbol.toUpperCase().includes(q) || l.underlyingSymbol?.toUpperCase().includes(q),
        ),
      );
    }
    return list;
  }, [orders, orderFilter, orderSearch]);

  if (!accessToken) {
    return (
      <div
        className="bg-background min-h-full flex-1"
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: f,
          background: C.bg,
        }}
      >
        <ConnectBrokerPrompt label="Connect Brokerage To View Orders" fontSize={16} />
      </div>
    );
  }

  if (portfolioStatus.status === "no_token") {
    return (
      <div
        className="bg-background min-h-full flex-1"
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          fontFamily: f,
          background: C.bg,
        }}
      >
        <div style={{ fontSize: 16, color: C.gold, letterSpacing: 1, textTransform: "uppercase" }}>
          SCHWAB SESSION EXPIRED
        </div>
        <div style={{ fontSize: 16, color: C.textDim, maxWidth: 320, textAlign: "center", lineHeight: 1.5 }}>
          Reconnect to resume live order updates.
        </div>
      </div>
    );
  }

  return (
    <div
      data-orders-root
      className="bg-background min-h-full flex-1"
      style={{ fontFamily: f, fontSize: 16, position: "relative", width: "100%", minWidth: 0, background: C.bg }}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          background: C.bg,
          borderBottom: `1px solid ${C.borderHi}`,
        }}
      >
        <SchwabAccountHeader />
        <div style={{ padding: "8px 12px 10px", borderTop: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: C.text, letterSpacing: 0.5, textTransform: "uppercase" }}>
            Orders
          </span>
        </div>
      </div>

      <div style={{ padding: "6px 10px", display: "flex", flexDirection: "column", gap: 6, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex" }}>
          {ORDER_FILTERS.map((fil) => (
            <button
              key={fil.value}
              onClick={() => setOrderFilter(fil.value)}
              style={{
                padding: "4px 10px",
                fontSize: 16,
                fontWeight: 500,
                letterSpacing: 0.5,
                fontFamily: f,
                textTransform: "uppercase",
                cursor: "pointer",
                color: orderFilter === fil.value ? C.gold : C.dim,
                background: "transparent",
                border: "none",
                borderBottom: orderFilter === fil.value ? `1px solid ${C.gold}` : "1px solid transparent",
              }}
            >
              {fil.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", border: `1px solid ${C.border}` }}>
          <Search style={{ width: 13, height: 13, marginLeft: 8, color: C.dim, flexShrink: 0 }} />
          <input
            type="text"
            value={orderSearch}
            onChange={(e) => setOrderSearch(e.target.value)}
            placeholder="Search orders..."
            style={{
              flex: 1,
              padding: "5px 7px",
              fontSize: 16,
              fontFamily: f,
              background: "transparent",
              border: "none",
              outline: "none",
              color: C.text,
            }}
          />
          {orderSearch && (
            <button
              onClick={() => setOrderSearch("")}
              style={{ paddingRight: 6, background: "transparent", border: "none", cursor: "pointer", color: C.dim }}
            >
              <XCircle style={{ width: 12, height: 12 }} />
            </button>
          )}
        </div>
      </div>

      {ordersLoading && orders.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 0", gap: 8 }}>
          <Loader2 className="animate-spin" style={{ width: 14, height: 14, color: C.gold }} />
          <div style={{ fontSize: 16, color: C.textDim, letterSpacing: 1, textTransform: "uppercase" }}>Loading orders</div>
        </div>
      ) : ordersError ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 0", gap: 8 }}>
          <div style={{ fontSize: 16, color: `${C.red}cc` }}>Failed to load orders</div>
          <button
            onClick={fetchOrders}
            style={{
              fontSize: 16,
              color: C.gold,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              letterSpacing: 1,
              fontFamily: f,
              textTransform: "uppercase",
            }}
          >
            RETRY
          </button>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 0" }}>
          <div style={{ fontSize: 16, color: C.textDim }}>
            {orderFilter === "ALL" && !orderSearch ? "No recent orders" : "No matching orders"}
          </div>
        </div>
      ) : (
        <>
          <div
            style={{
              padding: "5px 10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderBottom: `1px solid ${C.border}`,
              background: C.surface,
            }}
          >
            <span style={{ fontSize: 16, fontWeight: 500, color: C.dim, letterSpacing: 0.8, textTransform: "uppercase" }}>
              {orderFilter === "ALL" ? "All" : orderFilter} Orders
            </span>
            <span style={{ fontSize: 16, color: C.dim }}>{filteredOrders.length}</span>
          </div>
          {filteredOrders.map((order) => (
            <OrderRow key={order.orderId} order={order} onCancel={handleCancelOrder} />
          ))}
        </>
      )}
    </div>
  );
}