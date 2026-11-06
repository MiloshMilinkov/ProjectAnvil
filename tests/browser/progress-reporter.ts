import type {
  Reporter,
  TestCase,
  TestResult,
  TestStep,
} from "@playwright/test/reporter";
import { killOwnedProcessTree } from "../../scripts/test-runtime.mjs";
import {
  clearWorkerLeases,
  readWorkerLease,
  releaseWorkerLease,
} from "../../scripts/test-worker-lease.mjs";

const seconds = (milliseconds: number) => Math.round(milliseconds / 1000);
const setting = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

/**
 * Runs in the Playwright runner, outside the test workers.
 *
 * - Names the running test and its latest step while a test is slow, because
 *   non-interactive (CI) output otherwise shows nothing until a test ends.
 * - Stall watchdog: a worker whose browser or event loop is wedged can stop
 *   Playwright's own timeouts from ever firing. When a test makes no step
 *   progress for the stall window, its worker tree is stopped. Playwright
 *   then records that test as failed (and retries it when configured) and
 *   continues with a fresh worker instead of hanging the whole run.
 */
export default class ProgressReporter implements Reporter {
  private readonly interval = setting(
    "PROJECTANVIL_PROGRESS_INTERVAL_MS",
    15_000,
  );
  private readonly announceAfter = setting(
    "PROJECTANVIL_PROGRESS_ANNOUNCE_MS",
    60_000,
  );
  private readonly stallAfter = setting("PROJECTANVIL_STALL_MS", 300_000);
  private readonly running = new Map<
    TestResult,
    {
      test: TestCase;
      started: number;
      step: string;
      activity: number;
      announced: number;
      stopped: boolean;
    }
  >();
  private readonly workers = new Set<number>();
  private lastActivity = Date.now();
  private idleStopped = false;
  private timer?: ReturnType<typeof setInterval>;

  onBegin() {
    clearWorkerLeases();
    this.timer = setInterval(() => this.check(), this.interval);
    this.timer.unref();
  }

  onTestBegin(test: TestCase, result: TestResult) {
    const now = Date.now();
    this.touch();
    this.workers.add(result.workerIndex);
    this.running.set(result, {
      test,
      started: now,
      step: "setup",
      activity: now,
      announced: now,
      stopped: false,
    });
  }

  onStepBegin(_test: TestCase, result: TestResult, step: TestStep) {
    const state = this.running.get(result);
    this.touch();
    if (!state) return;
    state.step = step.titlePath().join(" › ") || step.title;
    state.activity = Date.now();
  }

  onStepEnd(_test: TestCase, result: TestResult) {
    const state = this.running.get(result);
    this.touch();
    if (state) state.activity = Date.now();
  }

  onTestEnd(_test: TestCase, result: TestResult) {
    this.touch();
    this.running.delete(result);
  }

  onEnd() {
    clearInterval(this.timer);
  }

  printsToStdio() {
    return false;
  }

  private touch() {
    this.lastActivity = Date.now();
    this.idleStopped = false;
  }

  private check() {
    const now = Date.now();
    for (const [result, state] of this.running) {
      const title = state.test.titlePath().filter(Boolean).join(" › ");
      const quiet = now - state.activity;
      if (
        now - state.started >= this.announceAfter &&
        now - state.announced >= this.announceAfter
      ) {
        state.announced = now;
        console.log(
          `[progress] still running after ${seconds(now - state.started)}s: ${title}\n` +
            `[progress]   latest step (${seconds(quiet)}s without progress): ${state.step}`,
        );
      }
      if (state.stopped || quiet < this.stallAfter) continue;
      state.stopped = true;
      console.error(
        `[watchdog] No progress for ${seconds(quiet)}s in: ${title}\n` +
          `[watchdog]   last step: ${state.step}\n` +
          `[watchdog]   Stopping its test worker so the run can continue.`,
      );
      this.stopWorker(result.workerIndex);
    }
    // A worker can also wedge between tests (startup or teardown).
    if (
      !this.running.size &&
      !this.idleStopped &&
      now - this.lastActivity >= this.stallAfter
    ) {
      this.idleStopped = true;
      console.error(
        `[watchdog] No test activity for ${seconds(now - this.lastActivity)}s; stopping idle test workers.`,
      );
      for (const workerIndex of this.workers) this.stopWorker(workerIndex);
    }
  }

  private stopWorker(workerIndex: number) {
    const pid = readWorkerLease(workerIndex);
    if (!pid) return;
    try {
      if (!killOwnedProcessTree(pid))
        console.error(
          `[watchdog]   Worker ${workerIndex} is no longer this runner's process; nothing stopped.`,
        );
      releaseWorkerLease(workerIndex);
    } catch (error) {
      console.error(
        `[watchdog]   Could not stop worker ${workerIndex}: ${(error as Error).message}`,
      );
    }
  }
}
