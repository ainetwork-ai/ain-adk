import type { Request, Response } from "express";
import type { AuthResponse } from "@/types/auth";

export abstract class BaseAuth {
	abstract authenticate(req: Request, res: Response): Promise<AuthResponse>;
}
