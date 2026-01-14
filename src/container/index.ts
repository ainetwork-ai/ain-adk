import { ControllerContainer } from "./controllers";
import { ServiceContainer } from "./services";

/**
 * Dependency Injection Container
 *
 * Provides singleton instances of services and controllers with proper dependency injection.
 * Benefits:
 * - Services maintain DI pattern (testable with mocks)
 * - Routes use clean, simple API
 * - Dependencies are explicit and traceable
 */
class Container {
	private _services: ServiceContainer;
	private _controllers: ControllerContainer;

	constructor() {
		this._services = new ServiceContainer();
		this._controllers = new ControllerContainer(this._services);
	}

	// Services
	get services(): ServiceContainer {
		return this._services;
	}

	// Controllers
	get controllers(): ControllerContainer {
		return this._controllers;
	}

	// Convenience methods for direct access
	getThreadService() {
		return this._services.getThreadService();
	}
	getIntentTriggerService() {
		return this._services.getIntentTriggerService();
	}
	getIntentFulfillService() {
		return this._services.getIntentFulfillService();
	}
	getQueryService() {
		return this._services.getQueryService();
	}
	getA2AService() {
		return this._services.getA2AService();
	}

	getQueryController() {
		return this._controllers.getQueryController();
	}
	getIntentController() {
		return this._controllers.getIntentController();
	}
	getModelApiController() {
		return this._controllers.getModelApiController();
	}
	getAgentApiController() {
		return this._controllers.getAgentApiController();
	}
	getThreadApiController() {
		return this._controllers.getThreadApiController();
	}
	getIntentApiController() {
		return this._controllers.getIntentApiController();
	}

	/**
	 * Reset all instances (useful for testing)
	 */
	reset(): void {
		this._services.reset();
		this._controllers.reset();
	}
}

// Export singleton instance
export const container = new Container();

// Export types for testing
export { ControllerContainer } from "./controllers";
export { ServiceContainer } from "./services";
