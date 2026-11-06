import fs from "node:fs";
import path from "node:path";
import { projectRoot } from "./test-runtime.mjs";

/**
 * Browser test workers record which process runs them so the stall watchdog
 * (in the Playwright runner) can stop exactly that worker tree. A lease is
 * honoured only for the same run and when its worker is the runner's child.
 */
export function leaseDirectory(
  engine = process.env.PROJECTANVIL_TEST_BROWSER || "all",
) {
  if (!/^[a-z]+$/.test(engine)) throw new Error("Invalid browser lease name.");
  return path.join(projectRoot, "outputs", "browser", engine, "workers");
}

const runIdentity = () => process.env.PROJECTANVIL_TEST_MANIFEST || "";

const leasePath = (directory, workerIndex) => {
  if (!Number.isInteger(workerIndex) || workerIndex < 0)
    throw new Error("Invalid worker index.");
  return path.join(directory, `${workerIndex}.json`);
};

export function writeWorkerLease(
  workerIndex,
  { directory = leaseDirectory(), pid = process.pid, ppid = process.ppid } = {},
) {
  fs.mkdirSync(directory, { recursive: true });
  const file = leasePath(directory, workerIndex);
  fs.writeFileSync(
    file,
    JSON.stringify({ format: 1, run: runIdentity(), workerIndex, pid, ppid }),
  );
  return () => releaseWorkerLease(workerIndex, { directory });
}

/** Returns the worker PID only when the lease belongs to this run and runner. */
export function readWorkerLease(
  workerIndex,
  { directory = leaseDirectory(), runnerPid = process.pid } = {},
) {
  let lease;
  try {
    lease = JSON.parse(fs.readFileSync(leasePath(directory, workerIndex), "utf8"));
  } catch {
    return undefined;
  }
  if (
    lease?.format !== 1 ||
    lease.run !== runIdentity() ||
    lease.workerIndex !== workerIndex ||
    lease.ppid !== runnerPid ||
    !Number.isInteger(lease.pid) ||
    lease.pid <= 0 ||
    lease.pid === runnerPid
  )
    return undefined;
  return lease.pid;
}

export function releaseWorkerLease(
  workerIndex,
  { directory = leaseDirectory() } = {},
) {
  fs.rmSync(leasePath(directory, workerIndex), { force: true });
}

export function clearWorkerLeases(directory = leaseDirectory()) {
  fs.rmSync(directory, { recursive: true, force: true });
}
