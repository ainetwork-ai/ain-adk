import type { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import type { ScheduledJobService } from "@/services/scheduled-job.service.js";
import type { SchedulerService } from "@/services/scheduler.service.js";
import type { ScheduledJob } from "@/types/memory.js";

export class ScheduledJobApiController {
	private scheduledJobService: ScheduledJobService;
	private schedulerService: SchedulerService;

	constructor(
		scheduledJobService: ScheduledJobService,
		schedulerService: SchedulerService,
	) {
		this.scheduledJobService = scheduledJobService;
		this.schedulerService = schedulerService;
	}

	public handleGetAllJobs = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const userId = res.locals.userId || "";
			const jobs = await this.scheduledJobService.listJobs(userId);
			res.json(jobs);
		} catch (error) {
			next(error);
		}
	};

	public handleGetJob = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const { id } = req.params as { id: string };
			const job = await this.scheduledJobService.getJob(id);
			if (!job) {
				res.status(StatusCodes.NOT_FOUND).send();
				return;
			}
			res.json(job);
		} catch (error) {
			next(error);
		}
	};

	public handleCreateJob = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const userId = res.locals.userId || "";
			const jobData = req.body as ScheduledJob;
			const created = await this.scheduledJobService.createJob({
				...jobData,
				userId,
			});

			// Register with the scheduler if active
			if (created.active) {
				this.schedulerService.scheduleJob(created);
			}

			res.status(StatusCodes.CREATED).json(created);
		} catch (error) {
			next(error);
		}
	};

	public handleUpdateJob = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const userId = res.locals.userId || "";
			const { id } = req.params as { id: string };
			const updates = req.body as Partial<ScheduledJob>;
			await this.scheduledJobService.updateJob(id, {
				...updates,
				userId,
			});

			// Reschedule with updated data
			const updatedJob = await this.scheduledJobService.getJob(id);
			if (updatedJob) {
				this.schedulerService.rescheduleJob(updatedJob);
			}

			res.status(StatusCodes.OK).send();
		} catch (error) {
			next(error);
		}
	};

	public handleDeleteJob = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const userId = res.locals.userId || "";
			const { id } = req.params as { id: string };

			// Remove from scheduler first
			this.schedulerService.unscheduleJob(id);

			await this.scheduledJobService.deleteJob(id, userId);
			res.status(StatusCodes.OK).send();
		} catch (error) {
			next(error);
		}
	};

	/**
	 * Manually trigger a scheduled job execution.
	 * Also usable by external schedulers (e.g., Cloud Scheduler, K8s CronJob).
	 */
	public handleRunJob = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const { id } = req.params as { id: string };
			const result = await this.scheduledJobService.executeJob(id);
			res.status(StatusCodes.OK).json(result);
		} catch (error) {
			next(error);
		}
	};
}
