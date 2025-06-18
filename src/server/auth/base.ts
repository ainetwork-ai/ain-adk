import { NextFunction, Request, Response } from "express";

export class BaseAuth {
  constructor() {
  }

  public middleware(): any {
    return (req: Request, res: Response, next: NextFunction) => {
      // Default middleware does nothing
      next();
    };
  }
}