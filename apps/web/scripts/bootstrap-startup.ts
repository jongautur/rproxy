// Run once by start-app.sh before `next start`. Ensures the live nginx
// default_server config matches whatever Settings → Nginx → Default Page
// currently shows (falling back to "nginx_default" if never configured) —
// otherwise setup.sh's placeholder ("return 444": drop the connection)
// stays live indefinitely until an admin happens to open Settings and
// click Save on that tab. Run via tsx directly (not through Next's build)
// to avoid instrumentation.ts's edge/nodejs dual-bundling requiring
// fs/promises-using code to also build cleanly for the edge runtime.
import { applyDefaultPageSettings } from "../src/server/services/default-page.service";

applyDefaultPageSettings()
  .catch((e) => {
    console.error("[bootstrap-startup] failed to apply default page settings:", e);
  })
  .finally(() => process.exit(0));
