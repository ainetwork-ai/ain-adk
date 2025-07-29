import type { Request, Response } from "express";

export abstract class BaseAuth {
	abstract authenticate(req: Request, res: Response): Promise<boolean>;
}
