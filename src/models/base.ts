export abstract class BaseModel {
  constructor() {
  }

  abstract fetch(): Promise<any>;
}