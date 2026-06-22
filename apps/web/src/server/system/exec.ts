import { execFile, spawn } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// Allowlist: only these exact binaries may be executed.
// Arguments for each are validated separately in the calling function.
const BINARY_ALLOWLIST = new Set([
  "/usr/sbin/nginx",
  "/bin/systemctl",
  "/usr/bin/sudo",
  "/usr/bin/openssl",
]);

// Shell metacharacters that must never appear in arguments
const SHELL_META = /[;&|`$<>\\\n\r]/;

// acme.sh lives in the user's home directory — path validated at call time
function getAcmePath(): string {
  const home = process.env.HOME;
  if (!home || !/^\/[a-zA-Z0-9/_-]+$/.test(home)) {
    throw new Error("HOME env not set or contains unsafe characters");
  }
  return `${home}/.acme.sh/acme.sh`;
}

function validateBinary(binary: string): void {
  if (!BINARY_ALLOWLIST.has(binary)) {
    throw new Error(`Binary not in allowlist: ${binary}`);
  }
}

function validateArgs(args: readonly string[]): void {
  for (const arg of args) {
    if (SHELL_META.test(arg)) {
      throw new Error(`Forbidden character in argument: ${JSON.stringify(arg)}`);
    }
  }
}

export async function hashPasswordApr1(password: string): Promise<string> {
  if (password.length > 256) throw new Error("Password too long");
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/openssl", ["passwd", "-apr1", "-stdin"], { shell: false });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { err += d.toString(); });
    child.on("close", (code: number | null) => {
      if (code !== 0) reject(new Error(`openssl failed (${code}): ${err}`));
      else resolve(out.trim());
    });
    child.stdin.write(password);
    child.stdin.end();
  });
}

export async function safeExec(
  binary: string,
  args: readonly string[],
  options?: { timeout?: number }
): Promise<ExecResult> {
  validateBinary(binary);
  validateArgs(args);

  try {
    const { stdout, stderr } = await execFileAsync(binary, [...args], {
      timeout: options?.timeout ?? 30_000,
      shell: false,
    });
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: (err.stdout ?? "").trim(),
      stderr: (err.stderr ?? "").trim(),
      exitCode: typeof err.code === "number" ? err.code : 1,
    };
  }
}

// Runs a command via sudo. Binary must be in the sudoers file.
export async function sudoExec(
  binary: string,
  args: readonly string[],
  options?: { timeout?: number }
): Promise<ExecResult> {
  validateArgs([binary, ...args]);
  return safeExec("/usr/bin/sudo", [binary, ...args], options);
}

// Runs acme.sh with validated arguments.
// Never passes user-controlled strings directly — callers must pre-validate domains/paths.
export async function acmeExec(
  args: readonly string[],
  options?: { timeout?: number; env?: NodeJS.ProcessEnv }
): Promise<ExecResult> {
  validateArgs(args);
  const acmePath = getAcmePath();

  try {
    const { stdout, stderr } = await execFileAsync(acmePath, [...args], {
      timeout: options?.timeout ?? 120_000,
      shell: false,
      env: { ...process.env, ...(options?.env ?? {}) } as NodeJS.ProcessEnv,
    });
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: (err.stdout ?? "").trim(),
      stderr: (err.stderr ?? "").trim(),
      exitCode: typeof err.code === "number" ? err.code : 1,
    };
  }
}

// Runs the nginx-config-helper.sh script via sudo.
// cmd is one of: deploy | enable | disable | remove | mkdir-ssl
// filename must match /^[a-zA-Z0-9._-]+\.conf$/ (validated inside the script too)
export async function nginxHelper(
  cmd: "deploy" | "enable" | "disable" | "remove" | "mkdir-ssl" | "log-size" | "log-clean"
      | "mkdir-access-lists" | "deploy-htpasswd" | "remove-htpasswd"
      | "stream-deploy" | "stream-remove" | "mkdir-stream",
  arg?: string
): Promise<ExecResult> {
  const helperPath = "/opt/rproxy/scripts/nginx-config-helper.sh";
  const args: string[] = [cmd];
  if (arg !== undefined) {
    if (cmd === "log-clean") {
      if (!/^[0-9]+$/.test(arg)) throw new Error(`Invalid log-clean argument: ${arg}`);
    } else if (cmd === "deploy-htpasswd" || cmd === "remove-htpasswd") {
      if (!/^[a-z0-9]+$/.test(arg)) throw new Error(`Invalid access list id: ${arg}`);
    } else {
      if (!/^[a-zA-Z0-9._-]+\.conf$/.test(arg)) throw new Error(`Invalid config filename: ${arg}`);
    }
    args.push(arg);
  }
  return safeExec("/usr/bin/sudo", [helperPath, ...args]);
}
