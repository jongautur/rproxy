import { writeFile, unlink, mkdir } from "fs/promises";
import path from "path";
import { testNginxConfig, reloadNginx } from "@/server/system/nginx";
import { nginxHelper } from "@/server/system/exec";

const STAGING_DIR = "/var/lib/rproxy/staging";

export interface DeployResult {
  success: boolean;
  output: string;
}

async function ensureStagingDir(): Promise<void> {
  await mkdir(STAGING_DIR, { recursive: true });
}

// Serializes deploys within this process so two concurrent admin requests
// can't interleave backup/deploy/test/restore steps against the same
// on-disk nginx state. rproxy runs as a single PM2 instance (fork mode),
// so an in-process mutex is sufficient — no cross-process lock needed.
let deployQueue: Promise<unknown> = Promise.resolve();
function withDeployLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = deployQueue.then(fn, fn);
  // Swallow errors here so one failed deploy doesn't wedge the queue for
  // later callers; the real error still propagates via `result`.
  deployQueue = result.catch(() => {});
  return result;
}

/**
 * Transactionally deploys a "site" config (proxy or redirect host) into
 * sites-available/sites-enabled:
 *   1. Stage the rendered config.
 *   2. Snapshot the current sites-available file + enabled state (backup).
 *   3. Atomically write the new file into its final path.
 *   4. If it should be enabled, symlink it in *before* testing, so
 *      `nginx -t` actually validates this config (not a no-op on an
 *      unlinked file) — then run the test.
 *   5. On test or reload failure, atomically restore the pre-deploy state
 *      and never reload — the previous config stays live.
 *   6. Reload only after a successful test.
 */
export async function deploySiteConfig(opts: {
  filename: string;
  config: string;
  enabled: boolean;
}): Promise<DeployResult> {
  return withDeployLock(async () => {
    const { filename, config, enabled } = opts;
    await ensureStagingDir();
    const stagingPath = path.join(STAGING_DIR, filename);
    await writeFile(stagingPath, config, "utf-8");

    try {
      const backupResult = await nginxHelper("backup", filename);
      if (backupResult.exitCode !== 0) {
        return { success: false, output: `Failed to snapshot previous config: ${backupResult.stderr || backupResult.stdout}` };
      }

      const deployResult = await nginxHelper("deploy", filename);
      if (deployResult.exitCode !== 0) {
        await nginxHelper("restore", filename);
        return { success: false, output: `Failed to deploy config: ${deployResult.stderr || deployResult.stdout}` };
      }

      if (!enabled) {
        // Ensure it's not left symlinked from a previous enabled state.
        await nginxHelper("disable", filename);
        return { success: true, output: "Config written (site disabled — not tested or reloaded)." };
      }

      await nginxHelper("enable", filename);

      const testResult = await testNginxConfig();
      if (!testResult.success) {
        await nginxHelper("restore", filename);
        return { success: false, output: `Config test failed:\n${testResult.output}` };
      }

      const reloadResult = await reloadNginx();
      if (!reloadResult.success) {
        await nginxHelper("restore", filename);
        return { success: false, output: `Reload failed, rolled back:\n${reloadResult.output}` };
      }

      return reloadResult;
    } finally {
      await unlink(stagingPath).catch(() => {});
    }
  });
}

export async function removeSiteConfig(filename: string): Promise<DeployResult> {
  return withDeployLock(async () => {
    await nginxHelper("remove", filename);
    return reloadNginx();
  });
}

// Flips a site's enabled/disabled (symlink) state without changing its
// content, testing and rolling back on failure — enabling a site can still
// break the config tree (port/server_name conflicts with other sites).
export async function setSiteEnabled(filename: string, enabled: boolean): Promise<DeployResult> {
  return withDeployLock(async () => {
    const backupResult = await nginxHelper("backup", filename);
    if (backupResult.exitCode !== 0) {
      return { success: false, output: `Failed to snapshot config: ${backupResult.stderr || backupResult.stdout}` };
    }

    if (enabled) {
      await nginxHelper("enable", filename);
      const testResult = await testNginxConfig();
      if (!testResult.success) {
        await nginxHelper("restore", filename);
        return { success: false, output: `Config test failed:\n${testResult.output}` };
      }
    } else {
      await nginxHelper("disable", filename);
    }

    const reloadResult = await reloadNginx();
    if (!reloadResult.success) {
      await nginxHelper("restore", filename);
      return { success: false, output: `Reload failed, rolled back:\n${reloadResult.output}` };
    }

    return reloadResult;
  });
}

/**
 * Same transaction as deploySiteConfig, but for stream.d configs, which
 * have no separate available/enabled split — a stream is either present in
 * /etc/nginx/stream.d or it isn't.
 */
export async function deployStreamConfig(opts: {
  filename: string;
  config: string;
}): Promise<DeployResult> {
  return withDeployLock(async () => {
    const { filename, config } = opts;
    await ensureStagingDir();
    const stagingPath = path.join(STAGING_DIR, filename);
    await writeFile(stagingPath, config, "utf-8");

    try {
      const backupResult = await nginxHelper("stream-backup", filename);
      if (backupResult.exitCode !== 0) {
        return { success: false, output: `Failed to snapshot previous stream config: ${backupResult.stderr || backupResult.stdout}` };
      }

      const deployResult = await nginxHelper("stream-deploy", filename);
      if (deployResult.exitCode !== 0) {
        await nginxHelper("stream-restore", filename);
        return { success: false, output: `Failed to deploy stream config: ${deployResult.stderr || deployResult.stdout}` };
      }

      const testResult = await testNginxConfig();
      if (!testResult.success) {
        await nginxHelper("stream-restore", filename);
        return { success: false, output: `Config test failed:\n${testResult.output}` };
      }

      const reloadResult = await reloadNginx();
      if (!reloadResult.success) {
        await nginxHelper("stream-restore", filename);
        return { success: false, output: `Reload failed, rolled back:\n${reloadResult.output}` };
      }

      return reloadResult;
    } finally {
      await unlink(stagingPath).catch(() => {});
    }
  });
}

export async function removeStreamConfig(filename: string): Promise<DeployResult> {
  return withDeployLock(async () => {
    const removeResult = await nginxHelper("stream-remove", filename);
    if (removeResult.exitCode !== 0) {
      return { success: false, output: `Failed to remove stream config: ${removeResult.stderr || removeResult.stdout}` };
    }
    return reloadNginx();
  });
}
