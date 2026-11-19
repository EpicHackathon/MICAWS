/** Mount in a partner page. getSession calls YOUR backend, never exposes a service key. */
export function embedMicaws({
  container,
  workspaceUrl,
  getSession,
  title = "Meeting workspace",
}: {
  container: HTMLElement;
  workspaceUrl: string | URL;
  getSession: () => Promise<{ token: string }>;
  title?: string;
}) {
  const url = new URL(workspaceUrl);
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(url.hostname)
  )
    throw new Error("Embed the workspace over HTTPS.");
  url.pathname = "/workspace";
  url.search = "";
  url.hash = "";
  const iframe = document.createElement("iframe");
  iframe.src = url.href;
  iframe.title = title;
  iframe.style.cssText = "width:100%;height:850px;border:0;border-radius:16px";
  iframe.referrerPolicy = "no-referrer";
  let stopped = false;
  async function connect() {
    const { token } = await getSession();
    if (!stopped)
      iframe.contentWindow?.postMessage(
        { type: "micaws:session", token },
        url.origin,
      );
  }
  const receive = (event: MessageEvent) => {
    if (
      event.source === iframe.contentWindow &&
      event.origin === url.origin &&
      event.data?.type === "micaws:ready"
    )
      connect().catch(() => {});
  };
  window.addEventListener("message", receive);
  container.appendChild(iframe);
  const renewal = setInterval(() => connect().catch(() => {}), 12 * 60 * 1000);
  return {
    iframe,
    reconnect: connect,
    destroy() {
      stopped = true;
      clearInterval(renewal);
      window.removeEventListener("message", receive);
      iframe.remove();
    },
  };
}
