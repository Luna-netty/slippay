import { useEffect } from "react";

// /zk is a static page served from public/zk/index.html. The Deno static server
// serves `/zk/index.html` directly but returns the SPA for the bare `/zk/` dir
// request — so redirecting to `/zk/` bounced back into the SPA, which matched
// this same `/zk` route again: an infinite redirect loop. Redirect to the
// explicit `/zk/index.html`, which the server serves as the real static ZK page.
export default function ZkRedirect() {
  useEffect(() => {
    window.location.replace("/zk/index.html");
  }, []);
  return null;
}
