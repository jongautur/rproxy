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

// Same backup/deploy/test/reload/rollback transaction as deploySiteConfig,
// but for a global conf.d snippet — no enable/disable split since a conf.d
// file is either present (and always active, being included at the http
// level for every site) or absent.
//
// `filename` is caller-supplied (validated by nginxHelper()/the helper
// script's validate_conf_filename, same as sites-available filenames) —
// this used to be hardcoded to the single real-ip snippet; generalized so
// the API Gateway's shared limit_req_zone file (see zones.service.ts) can
// reuse the same transaction instead of a parallel implementation.
export async function deployConfDConfig(filename: string, config: string): Promise<DeployResult> {
  return withDeployLock(async () => {
    await ensureStagingDir();
    const stagingPath = path.join(STAGING_DIR, filename);
    await writeFile(stagingPath, config, "utf-8");

    try {
      const backupResult = await nginxHelper("confd-backup", filename);
      if (backupResult.exitCode !== 0) {
        return { success: false, output: `Failed to snapshot previous config: ${backupResult.stderr || backupResult.stdout}` };
      }

      const deployResult = await nginxHelper("confd-deploy", filename);
      if (deployResult.exitCode !== 0) {
        await nginxHelper("confd-restore", filename);
        return { success: false, output: `Failed to deploy config: ${deployResult.stderr || deployResult.stdout}` };
      }

      const testResult = await testNginxConfig();
      if (!testResult.success) {
        await nginxHelper("confd-restore", filename);
        return { success: false, output: `Config test failed:\n${testResult.output}` };
      }

      const reloadResult = await reloadNginx();
      if (!reloadResult.success) {
        await nginxHelper("confd-restore", filename);
        return { success: false, output: `Reload failed, rolled back:\n${reloadResult.output}` };
      }

      return reloadResult;
    } finally {
      await unlink(stagingPath).catch(() => {});
    }
  });
}

export async function removeConfDConfig(filename: string): Promise<DeployResult> {
  return withDeployLock(async () => {
    const backupResult = await nginxHelper("confd-backup", filename);
    if (backupResult.exitCode !== 0) {
      return { success: false, output: `Failed to snapshot previous config: ${backupResult.stderr || backupResult.stdout}` };
    }

    const removeResult = await nginxHelper("confd-remove", filename);
    if (removeResult.exitCode !== 0) {
      return { success: false, output: `Failed to remove config: ${removeResult.stderr || removeResult.stdout}` };
    }

    const testResult = await testNginxConfig();
    if (!testResult.success) {
      await nginxHelper("confd-restore", filename);
      return { success: false, output: `Config test failed:\n${testResult.output}` };
    }

    const reloadResult = await reloadNginx();
    if (!reloadResult.success) {
      await nginxHelper("confd-restore", filename);
      return { success: false, output: `Reload failed, rolled back:\n${reloadResult.output}` };
    }

    return reloadResult;
  });
}

// ── Atomic multi-file deploy ────────────────────────────────────────────────
//
// The API Gateway's shared limit_req_zone conf.d file and a per-Api site
// file must change together whenever a route's rate limit is added,
// changed, or removed — the site file's `limit_req zone=<name>` references
// a zone name the zones file defines. Deploying them as two SEPARATE
// deploySiteConfig()/deployConfDConfig() calls has no safe ordering: zones
// added first, then a stale site referencing an old zone that got removed
// still momentarily exists between the two reloads either way, and either
// ordering means the "other" file's version is briefly inconsistent with
// what's live between the two independent `nginx -t`/reload cycles. This
// runs ONE `nginx -t` and ONE reload across the whole batch, staged and
// backed up first, so it's all-or-nothing: either every file in the batch
// is live and consistent, or none of the changes took effect at all.
export interface BatchEntry {
  kind: "site" | "confd";
  filename: string;
  config: string;
  enabled?: boolean; // site only — ignored for confd entries
  remove?: boolean;  // deploy nothing; back up + remove this file instead
}

export async function deployConfigBatch(entries: BatchEntry[]): Promise<DeployResult> {
  return withDeployLock(async () => {
    await ensureStagingDir();
    const stagingPaths: string[] = [];
    const backedUp: BatchEntry[] = [];

    async function restoreAll(): Promise<void> {
      // Reverse order is not load-bearing here (each entry's restore is
      // independent — same as every other restore-on-failure path in this
      // file), just tidy.
      for (const entry of [...backedUp].reverse()) {
        if (entry.kind === "site") {
          await nginxHelper("restore", entry.filename);
        } else {
          await nginxHelper("confd-restore", entry.filename);
        }
      }
    }

    try {
      for (const entry of entries) {
        if (!entry.remove) {
          const stagingPath = path.join(STAGING_DIR, entry.filename);
          await writeFile(stagingPath, entry.config, "utf-8");
          stagingPaths.push(stagingPath);
        }

        const backupResult = entry.kind === "site"
          ? await nginxHelper("backup", entry.filename)
          : await nginxHelper("confd-backup", entry.filename);
        if (backupResult.exitCode !== 0) {
          await restoreAll();
          return { success: false, output: `Failed to snapshot ${entry.filename}: ${backupResult.stderr || backupResult.stdout}` };
        }
        backedUp.push(entry);

        if (entry.remove) {
          const removeResult = entry.kind === "site"
            ? await nginxHelper("remove", entry.filename)
            : await nginxHelper("confd-remove", entry.filename);
          if (removeResult.exitCode !== 0) {
            await restoreAll();
            return { success: false, output: `Failed to remove ${entry.filename}: ${removeResult.stderr || removeResult.stdout}` };
          }
          continue;
        }

        const deployResult = entry.kind === "site"
          ? await nginxHelper("deploy", entry.filename)
          : await nginxHelper("confd-deploy", entry.filename);
        if (deployResult.exitCode !== 0) {
          await restoreAll();
          return { success: false, output: `Failed to deploy ${entry.filename}: ${deployResult.stderr || deployResult.stdout}` };
        }

        if (entry.kind === "site") {
          await nginxHelper(entry.enabled ? "enable" : "disable", entry.filename);
        }
      }

      const testResult = await testNginxConfig();
      if (!testResult.success) {
        await restoreAll();
        return { success: false, output: `Config test failed:\n${testResult.output}` };
      }

      const reloadResult = await reloadNginx();
      if (!reloadResult.success) {
        await restoreAll();
        return { success: false, output: `Reload failed, rolled back:\n${reloadResult.output}` };
      }

      return reloadResult;
    } finally {
      for (const p of stagingPaths) {
        await unlink(p).catch(() => {});
      }
    }
  });
}
