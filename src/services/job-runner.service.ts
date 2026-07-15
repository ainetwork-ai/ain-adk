import { classifyJobError } from "@/utils/job-error.js";
import { loggers } from "@/utils/logger.js";

/**
 * Reliability layer for scheduled jobs. Serializes LLM pressure through a
 * semaphore, skips overlapping runs of the same jobKey, retries retryable
 * errors with backoff, and pauses ALL dispatch during a rate-limit cooldown.
 *
 * Deliberately storage-free: run history is recorded by the caller
 * (SchedulerService) around submit().
 */

export interface Job {
	/** Overlap key. WORKFLOW: workflowId, slot refresh: `${documentId}:${slotId}`. */
	jobKey: string;
	execute: () => Promise<void>;
}

export type JobOutcome =
	| { status: "success"; attempts: number }
	| { status: "failed"; attempts: number; error: string }
	| { status: "skipped_overlap"; attempts: 0 };

export interface JobRunnerOptions {
	/** Max jobs executing at once. Default: env SCHEDULER_MAX_CONCURRENT or 2. */
	maxConcurrent?: number;
	/** Waits between attempts; attempts = length + 1. */
	retryDelaysMs?: number[];
	/** Global dispatch pause after a rate limit without Retry-After. */
	cooldownMs?: number;
}

const DEFAULT_RETRY_DELAYS_MS = [30_000, 120_000, 480_000];

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export class JobRunnerService {
	private maxConcurrent: number;
	private retryDelaysMs: number[];
	private cooldownMs: number;

	private active = 0;
	private waitQueue: Array<() => void> = [];
	private runningKeys = new Set<string>();
	private cooldownUntil = 0;
	private inFlight = new Set<Promise<JobOutcome>>();

	constructor(options?: JobRunnerOptions) {
		this.maxConcurrent =
			options?.maxConcurrent ??
			Number.parseInt(process.env.SCHEDULER_MAX_CONCURRENT ?? "2", 10);
		this.retryDelaysMs = options?.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
		this.cooldownMs = options?.cooldownMs ?? 60_000;
	}

	async submit(job: Job): Promise<JobOutcome> {
		if (this.runningKeys.has(job.jobKey)) {
			loggers.agent.warn(`Job overlap, skipping: ${job.jobKey}`);
			return { status: "skipped_overlap", attempts: 0 };
		}
		this.runningKeys.add(job.jobKey);
		const run = this.run(job);
		this.inFlight.add(run);
		try {
			return await run;
		} finally {
			this.inFlight.delete(run);
			this.runningKeys.delete(job.jobKey);
		}
	}

	/** Waits for in-flight jobs to settle (graceful shutdown). */
	async drain(timeoutMs = 30_000): Promise<void> {
		let timeoutHandle: NodeJS.Timeout | undefined;
		const timeout = new Promise<void>((resolve) => {
			timeoutHandle = setTimeout(resolve, timeoutMs);
		});
		try {
			await Promise.race([Promise.allSettled([...this.inFlight]), timeout]);
		} finally {
			clearTimeout(timeoutHandle);
		}
	}

	private async run(job: Job): Promise<JobOutcome> {
		await this.acquire();
		try {
			const maxAttempts = this.retryDelaysMs.length + 1;
			let lastError = "";
			for (let attempt = 1; attempt <= maxAttempts; attempt++) {
				await this.waitForCooldown();
				try {
					await job.execute();
					return { status: "success", attempts: attempt };
				} catch (error) {
					const classification = classifyJobError(error);
					lastError = error instanceof Error ? error.message : String(error);
					loggers.agent.error(
						`Job attempt ${attempt}/${maxAttempts} failed: ${job.jobKey}`,
						{ error: lastError, retryable: classification.retryable },
					);
					if (classification.rateLimited) {
						this.cooldownUntil = Math.max(
							this.cooldownUntil,
							Date.now() + (classification.retryAfterMs ?? this.cooldownMs),
						);
					}
					if (!classification.retryable || attempt === maxAttempts) {
						return { status: "failed", attempts: attempt, error: lastError };
					}
					await sleep(
						classification.retryAfterMs ?? this.retryDelaysMs[attempt - 1],
					);
				}
			}
			return { status: "failed", attempts: maxAttempts, error: lastError };
		} finally {
			this.release();
		}
	}

	private async waitForCooldown(): Promise<void> {
		while (Date.now() < this.cooldownUntil) {
			await sleep(this.cooldownUntil - Date.now());
		}
	}

	private acquire(): Promise<void> {
		if (this.active < this.maxConcurrent) {
			this.active++;
			return Promise.resolve();
		}
		return new Promise((resolve) => {
			this.waitQueue.push(() => {
				this.active++;
				resolve();
			});
		});
	}

	private release(): void {
		this.active--;
		const next = this.waitQueue.shift();
		if (next) next();
	}
}
