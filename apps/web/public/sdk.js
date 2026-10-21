/*!
 * SlipPay Web SDK · v0.1.0
 * Drop-in checkout modal. Requires the merchant's backend to have already
 * created an order via POST /v1/orders (returns order.id). Frontend opens
 * a modal-iframe to the SlipPay-hosted checkout and receives a postMessage
 * on paid / cancelled / expired.
 *
 * Usage:
 *   <script src="https://app.slippay.app/sdk.js"></script>
 *   <script>
 *     Slippay.open({
 *       orderId: "ord_abc...",
 *       onPaid: (e) => console.log("paid", e.txHash),
 *       onCancelled: () => console.log("cancelled"),
 *       onExpired: () => console.log("expired"),
 *     });
 *   </script>
 */
(function () {
  "use strict";

  var DEFAULT_ENV = "https://app.slippay.app";
  var ALLOWED_TYPES = { "slippay:paid": "onPaid", "slippay:cancelled": "onCancelled", "slippay:expired": "onExpired", "slippay:error": "onError" };

  function buildModal(iframeSrc, originForCheck, callbacks) {
    var backdrop = document.createElement("div");
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.style.cssText = [
      "position:fixed", "inset:0", "z-index:2147483647",
      "background:rgba(10,10,10,0.55)",
      "backdrop-filter:blur(4px)",
      "-webkit-backdrop-filter:blur(4px)",
      "display:flex", "align-items:center", "justify-content:center",
      "padding:16px",
      "font-family:ui-sans-serif,system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif",
    ].join(";");

    var frameWrap = document.createElement("div");
    frameWrap.style.cssText = [
      "position:relative",
      "width:100%", "max-width:480px", "height:100%", "max-height:720px",
      "background:#f1eee7",
      "box-shadow:0 30px 80px rgba(0,0,0,0.4)",
    ].join(";");

    var iframe = document.createElement("iframe");
    iframe.src = iframeSrc;
    iframe.title = "SlipPay checkout";
    iframe.style.cssText = "border:0;width:100%;height:100%;display:block;background:#f1eee7";
    iframe.allow = "clipboard-write";

    var closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.style.cssText = [
      "position:absolute", "top:-44px", "right:0",
      "background:transparent", "border:0",
      "color:#f1eee7", "font-size:32px",
      "cursor:pointer", "padding:4px 12px",
      "line-height:1",
    ].join(";");

    frameWrap.appendChild(iframe);
    frameWrap.appendChild(closeBtn);
    backdrop.appendChild(frameWrap);

    var prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.appendChild(backdrop);

    var resolved = false;

    function teardown() {
      if (!backdrop.parentNode) return;
      backdrop.parentNode.removeChild(backdrop);
      document.body.style.overflow = prevBodyOverflow;
      window.removeEventListener("message", onMessage);
    }

    function fire(type, payload) {
      if (resolved) return;
      resolved = true;
      var cb = callbacks[ALLOWED_TYPES[type]];
      teardown();
      if (typeof cb === "function") {
        try { cb(payload || {}); } catch (e) { console.error("[Slippay] callback threw:", e); }
      }
    }

    function onMessage(ev) {
      if (ev.origin !== originForCheck) return;
      var data = ev.data;
      if (!data || typeof data !== "object") return;
      if (!ALLOWED_TYPES.hasOwnProperty(data.type)) return;
      fire(data.type, data);
    }

    closeBtn.addEventListener("click", function () { fire("slippay:cancelled", {}); });
    backdrop.addEventListener("click", function (ev) {
      if (ev.target === backdrop) fire("slippay:cancelled", {});
    });
    document.addEventListener("keydown", function escHandler(ev) {
      if (ev.key === "Escape") {
        document.removeEventListener("keydown", escHandler);
        fire("slippay:cancelled", {});
      }
    });
    window.addEventListener("message", onMessage);

    return { close: function () { fire("slippay:cancelled", {}); } };
  }

  var Slippay = {
    version: "0.1.0",

    /**
     * Open the checkout modal for a previously-created order.
     * @param {Object} opts
     * @param {string} opts.orderId  — order id returned by POST /v1/orders
     * @param {string} [opts.env]    — base URL of slippay frontend (default "https://app.slippay.app")
     * @param {(e:{txHash?:string})=>void} [opts.onPaid]
     * @param {()=>void} [opts.onCancelled]
     * @param {()=>void} [opts.onExpired]
     * @param {(e:{message?:string})=>void} [opts.onError]
     * @returns {{close:()=>void}}
     */
    open: function (opts) {
      if (!opts || typeof opts.orderId !== "string" || !opts.orderId) {
        throw new Error("Slippay.open: orderId is required");
      }
      var env = opts.env || DEFAULT_ENV;
      // strip trailing slashes
      env = env.replace(/\/+$/, "");
      var src = env + "/checkout/" + encodeURIComponent(opts.orderId) + "?embed=1";
      var origin;
      try { origin = new URL(env).origin; } catch (e) { throw new Error("Slippay.open: invalid env URL"); }
      return buildModal(src, origin, {
        onPaid: opts.onPaid,
        onCancelled: opts.onCancelled,
        onExpired: opts.onExpired,
        onError: opts.onError,
      });
    },
  };

  // expose
  if (typeof window !== "undefined") {
    window.Slippay = Slippay;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Slippay;
  }
})();
