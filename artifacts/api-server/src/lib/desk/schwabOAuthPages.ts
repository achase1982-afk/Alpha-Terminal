function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type TraderSuccessOpts = {
  /** Shown under the brokerage lead line when app 2 finished after app 1 chain. */
  marketDataAlsoConnected?: boolean;
};

/** App 1 trader callback success page (shared with app 2 callback). */
export function traderSuccessPage(opts: TraderSuccessOpts = {}): string {
  const marketExtra = opts.marketDataAlsoConnected
    ? `<p style="color:#bbb;font-size:14px;line-height:1.55;margin:0 0 8px;max-width:320px;margin-left:auto;margin-right:auto">Schwab market data (app 2) is also connected.</p>`
    : "";
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connected</title></head>
    <body style="background:#0A0F16;color:#fff;font-family:-apple-system,system-ui,sans-serif;padding:60px 20px;text-align:center;margin:0">
      <div style="font-size:14px;color:#FFB800;letter-spacing:0.18em;font-weight:700;margin-bottom:14px">ALPHA TERMINAL</div>
      <div style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;background:rgba(0,200,140,0.15);margin-bottom:18px">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00C88C" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <h2 style="color:#00C88C;font-size:18px;margin:0 0 10px">Connected to Schwab</h2>
      <p style="color:#bbb;font-size:14px;line-height:1.55;margin:0 0 8px;max-width:320px;margin-left:auto;margin-right:auto">Your brokerage is linked.</p>
      ${marketExtra}
      <p style="color:#888;font-size:13px;line-height:1.55;margin:0 0 28px;max-width:320px;margin-left:auto;margin-right:auto">Tap the <strong style="color:#fff">X</strong> in the top corner to return to Alpha Terminal. Your portfolio will load automatically.</p>
      <button id="closeBtn" style="display:inline-block;background:#FFB800;color:#000;font-size:13px;font-weight:700;letter-spacing:0.05em;padding:10px 28px;border:none;border-radius:8px;cursor:pointer;font-family:-apple-system,system-ui,sans-serif">CLOSE THIS PAGE</button>
      <script>
        (function () {
          function closeSelf() { try { window.close(); } catch (e) {} }
          closeSelf();
          setTimeout(closeSelf, 250);
          setTimeout(closeSelf, 1000);
          var btn = document.getElementById('closeBtn');
          if (btn) btn.addEventListener('click', closeSelf);
        })();
      </script>
    </body></html>`;
}

export function errorPage(title: string, msg: string): string {
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="background:#0A0F16;color:#fff;font-family:-apple-system,system-ui,sans-serif;padding:60px 20px;text-align:center">
      <h2 style="color:#FF1744;font-size:18px;margin-bottom:12px">${escapeHtml(title)}</h2>
      <p style="color:#ccc;font-size:14px;line-height:1.5;margin-bottom:32px">${escapeHtml(msg)}</p>
      <button
        onclick="window.close(); setTimeout(function(){ history.back(); }, 300);"
        style="display:inline-block;background:#FFB800;color:#000;font-size:14px;font-weight:700;letter-spacing:0.05em;padding:12px 32px;border:none;border-radius:8px;cursor:pointer;font-family:-apple-system,system-ui,sans-serif"
      >Close &amp; Return</button>
      <p style="margin-top:24px;font-size:12px;color:#555">If the button doesn&#39;t close this tab, you can close it manually and return to Alpha Terminal.</p>
    </body></html>`;
}

/** Standalone app-2-only reconnect success (same chrome as traderSuccessPage). */
export function schwab2StandaloneSuccessPage(): string {
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connected</title></head>
    <body style="background:#0A0F16;color:#fff;font-family:-apple-system,system-ui,sans-serif;padding:60px 20px;text-align:center;margin:0">
      <div style="font-size:14px;color:#FFB800;letter-spacing:0.18em;font-weight:700;margin-bottom:14px">ALPHA TERMINAL</div>
      <div style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;background:rgba(0,200,140,0.15);margin-bottom:18px">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00C88C" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <h2 style="color:#00C88C;font-size:18px;margin:0 0 10px">Connected to Schwab</h2>
      <p style="color:#bbb;font-size:14px;line-height:1.55;margin:0 0 8px;max-width:320px;margin-left:auto;margin-right:auto">Schwab market data (app 2) is linked for desk quotes, chains, and bars.</p>
      <p style="color:#888;font-size:13px;line-height:1.55;margin:0 0 28px;max-width:320px;margin-left:auto;margin-right:auto">Tap the <strong style="color:#fff">X</strong> in the top corner to return to Alpha Terminal.</p>
      <button id="closeBtn" style="display:inline-block;background:#FFB800;color:#000;font-size:13px;font-weight:700;letter-spacing:0.05em;padding:10px 28px;border:none;border-radius:8px;cursor:pointer;font-family:-apple-system,system-ui,sans-serif">CLOSE THIS PAGE</button>
      <script>
        (function () {
          function closeSelf() { try { window.close(); } catch (e) {} }
          closeSelf();
          setTimeout(closeSelf, 250);
          setTimeout(closeSelf, 1000);
          var btn = document.getElementById('closeBtn');
          if (btn) btn.addEventListener('click', closeSelf);
        })();
      </script>
    </body></html>`;
}
