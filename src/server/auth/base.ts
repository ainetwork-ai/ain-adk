export class BaseAuth {
  constructor() {
  }

  public middleware(): any {
    return (req: any, res: any, next: any) => {
      // Default middleware does nothing
      next();
    };
  }
}